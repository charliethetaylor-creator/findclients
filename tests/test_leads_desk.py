"""FindClients: real DB/API checks with all external research and AI mocked."""
import asyncio
import csv
import io
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import harvey.dashboard as dash
import harvey.leads as leads
from harvey.config import load_config
from harvey.outreach_policy import OutreachDisabled
from harvey.state import StateManager


@pytest.fixture
def desk(tmp_path, monkeypatch):
    db = tmp_path / 'data' / 'test.db'
    config = tmp_path / 'harvey.yaml'
    template = Path(__file__).parents[1] / 'harvey.yaml'
    config.write_text(template.read_text())
    monkeypatch.setattr(dash, 'DB_PATH', db)
    monkeypatch.setattr(dash, '_resolve_config_file', lambda: tmp_path / 'harvey.local.yaml' if (tmp_path / 'harvey.local.yaml').exists() else config)
    dash.token_store.configure(tmp_path / 'token')
    with TestClient(dash.app, base_url='http://127.0.0.1:5555', headers={'Authorization':'Bearer '+dash.token_store.get()}) as client:
        yield client, db, config


def add(client, name='Acme', url='https://acme.example'):
    response = client.post('/api/leads', json={'name':name,'website':url})
    assert response.status_code == 200, response.text
    return response.json()['id']


def evidence(client, key, quote='We are hiring three customer support agents this month.', url='https://acme.example/careers'):
    r = client.post(f'/api/leads/{key}/evidence', json={'url':url,'quote':quote,'kind':'website'})
    assert r.status_code == 200, r.text
    return next(l for l in client.get('/api/leads').json()['leads'] if l['id']==key)['evidence'][0]['id']


def set_product(client):
    r=client.post('/api/leads/product', json={'name':'Support Desk','description':'A support tool that groups repeat enquiries so support teams can answer them efficiently.','customer':'Small SaaS customer support teams'})
    assert r.status_code == 200, r.text


def test_empty_install_and_manual_company_survive_reload(desk):
    client,db,_=desk
    assert client.get('/api/leads').json()['leads']==[]
    key=add(client)
    data=client.get('/api/leads').json()
    assert data['sending_enabled'] is False
    assert data['leads'][0]['id']==key
    assert data['leads'][0]['evidence']==[]
    assert client.post('/api/leads',json={'name':'Duplicate','website':'https://acme.example/about'}).status_code==409


def test_checked_export_has_sources_no_formulas_and_omits_unchecked(desk):
    client,_,_=desk
    key=add(client, '=1+1')
    eid=evidence(client,key)
    assert len(list(csv.DictReader(io.StringIO(client.get('/api/leads/export.csv').text))))==0
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    output=list(csv.DictReader(io.StringIO(client.get('/api/leads/export.csv').text)))
    assert len(output)==1 and output[0]['company']=="'=1+1"
    assert output[0]['source_url']=='https://acme.example/careers'
    assert output[0]['evidence_quote'].startswith('We are hiring')


def test_evidence_isolation_and_input_validation(desk):
    client,_,_=desk
    one=add(client)
    two=add(client,'Other','https://other.example')
    eid=evidence(client,one)
    assert client.patch(f'/api/leads/{two}/evidence/{eid}',json={'confirmed':True}).status_code==404
    assert client.post(f'/api/leads/{one}/evidence',json={'url':'javascript:alert(1)','quote':'Long enough malicious quote'}).status_code==422
    assert client.patch(f'/api/leads/{one}',json={'stage':'paying_customer'}).status_code==422


def test_manual_outcomes_do_not_equate_sold_with_replies(desk):
    client,_,_=desk
    one=add(client)
    client.patch(f'/api/leads/{one}',json={'stage':'sold','asking_price':5,'notes':'Sample sold'})
    assert client.get('/api/leads').json()['metrics']['contacted_at']==0
    client.patch(f'/api/leads/{one}',json={'stage':'interested','notes':'Actual positive reply'})
    client.patch(f'/api/leads/{one}',json={'stage':'archived'})
    assert client.get('/api/leads').json()['metrics']=={'contacted_at':1,'replied_at':1,'interested_at':1}


@pytest.mark.parametrize('path',['/api/harvey/start','/api/sending-mode','/api/sending/resume','/api/outbox/approve-all','/api/outbox/abc/approve'])
def test_old_sales_actions_are_disabled_even_when_authenticated(desk,path):
    client,_,_=desk
    assert client.post(path,json={'mode':'autopilot','confirm':'autopilot'}).status_code==403
    assert client.post(path,json={},headers={'Authorization':'Bearer invalid'}).status_code==401


@pytest.mark.asyncio
@pytest.mark.parametrize('module,class_name', [('gmail','GmailProvider'),('microsoft','MicrosoftProvider'),('smtp_mail','SmtpImapProvider')])
async def test_mail_integrations_refuse_before_credentials_or_network(module,class_name):
    import importlib
    cls=getattr(importlib.import_module('harvey.integrations.'+module),class_name)
    instance=object.__new__(cls)
    with pytest.raises(OutreachDisabled):
        await instance.send_email('person@example.com','subject','body')


def test_drafts_require_real_product_and_confirmed_evidence(desk,monkeypatch):
    client,db,_=desk
    key=add(client)
    eid=evidence(client,key)
    assert client.post(f'/api/leads/{key}/draft',json={'evidence_id':eid}).status_code==400
    set_product(client)
    assert client.post(f'/api/leads/{key}/draft',json={'evidence_id':eid}).status_code==400
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    model=AsyncMock(return_value={'evidence_id':eid,'message':'Saw you are hiring three support agents. How are you handling repeat customer enquiries as the team grows?'})
    monkeypatch.setattr(leads.Brain,'think_json',model)
    r=client.post(f'/api/leads/{key}/draft',json={'evidence_id':eid,'channel':'sms'})
    assert r.status_code==200 and r.json()['sent'] is False
    assert 'untrusted' in model.call_args.args[0]
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':False})
    assert client.get('/api/leads').json()['leads'][0]['draft']==''


def test_product_change_invalidates_old_drafts(desk):
    client,db,_=desk
    key=add(client)
    asyncio.run(leads.workflow(db,key))
    asyncio.run(leads.execute(db,"UPDATE lead_workflows SET draft='old product message' WHERE lead_id=?",(key,)))
    set_product(client)
    assert client.get('/api/leads').json()['leads'][0]['draft']==''


def test_opted_out_domain_cannot_be_exported_or_drafted(desk):
    import yaml
    client,_,config=desk
    set_product(client)
    key=add(client)
    eid=evidence(client,key)
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    local=config.parent/'harvey.local.yaml'
    data=yaml.safe_load(local.read_text());data['compliance']['do_not_contact']=['acme.example'];local.write_text(yaml.safe_dump(data))
    assert client.get('/api/leads').json()['leads'][0]['suppressed']
    assert len(list(csv.DictReader(io.StringIO(client.get('/api/leads/export.csv').text))))==0
    assert client.post(f'/api/leads/{key}/draft',json={'evidence_id':eid}).status_code==409


@pytest.mark.asyncio
async def test_research_rejects_hallucinated_excerpts_and_labels_manual_sources(desk,monkeypatch):
    client,db,config=desk
    key=add(client)
    lead=(await leads.all_leads(db))[0]
    await leads.workflow(db,key)
    class FakeResponse:
        status_code=200
        content=b'User-agent: *\nAllow: /'
        text='User-agent: *\nAllow: /'
    class FakeClient:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url):return FakeResponse()
    monkeypatch.setattr(leads,'public_http_client',lambda **kwargs:FakeClient())
    html='<html><p>We are hiring three customer support agents this month.</p><p>Email info@acme.example</p></html>'
    monkeypatch.setattr(leads,'read_page',AsyncMock(return_value=('We are hiring three customer support agents this month.', [('https://linkedin.com/company/acme','LinkedIn')],html)))
    monkeypatch.setattr(leads.Brain,'think_json',AsyncMock(return_value=[
        {'url':'https://acme.example','quote':'We are hiring three customer support agents this month.','relevance':'May have repeat enquiry workload.'},
        {'url':'https://acme.example','quote':'The founder is desperate to buy a support tool.'},
        {'url':'https://not-visited.example','quote':'We are hiring three customer support agents this month.'}]))
    await leads.research_lead(db,lead,config)
    out=(await leads.all_leads(db))[0]
    assert out['research_status']=='complete'
    assert len(out['evidence'])==1 and not out['evidence'][0]['confirmed']
    assert out['sources'][0]['status']=='manual_review'
    assert any(c['value']=='info@acme.example' for c in out['public_contacts'])


def test_no_auth_on_new_leads_routes(desk):
    client,_,_=desk
    for path in ['/api/leads','/api/leads/product','/api/leads/export.csv']:
        assert client.get(path,headers={'Authorization':'Bearer wrong'}).status_code==401


def test_single_record_export_does_not_include_other_prospects(desk):
    client,_,_=desk
    keys=[add(client),add(client,'Another company','https://another.example')]
    for key in keys:
        eid=evidence(client,key)
        client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    result=list(csv.DictReader(io.StringIO(client.get('/api/leads/export.csv',params={'lead_id':keys[0]}).text)))
    assert len(result)==1 and result[0]['company']=='Acme'
    assert client.get('/api/leads/export.csv',params={'lead_id':'missing'}).status_code==404


def test_new_product_withdraws_checks_to_force_relevance_review(desk):
    client,_,_=desk
    key=add(client)
    eid=evidence(client,key)
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    set_product(client)
    assert not client.get('/api/leads').json()['leads'][0]['evidence'][0]['confirmed']


@pytest.mark.asyncio
async def test_legacy_instantly_cannot_activate_or_reply():
    from harvey.integrations.instantly import InstantlyClient
    client=object.__new__(InstantlyClient)
    with pytest.raises(OutreachDisabled):
        await client.activate_campaign('old-queued-campaign')
    with pytest.raises(OutreachDisabled):
        await client.send_reply('reply-id','body')


@pytest.mark.asyncio
async def test_no_heartbeat_sending_or_reply_processing():
    from harvey.main import heartbeat
    from harvey.agents.sender import Sender
    from harvey.agents.handler import Handler
    await heartbeat()  # returns before config, credential, network or subprocess access
    await object.__new__(Sender).run()
    assert await object.__new__(Handler).run() is True


def test_manual_do_not_contact_stage_blocks_drafting_and_export(desk):
    client,_,_=desk
    set_product(client)
    key=add(client)
    eid=evidence(client,key)
    client.patch(f'/api/leads/{key}/evidence/{eid}',json={'confirmed':True})
    assert client.patch(f'/api/leads/{key}',json={'stage':'do_not_contact'}).status_code==200
    assert client.get('/api/leads').json()['leads'][0]['suppressed']
    assert not list(csv.DictReader(io.StringIO(client.get('/api/leads/export.csv').text)))
    assert client.post(f'/api/leads/{key}/draft',json={'evidence_id':eid}).status_code==409
