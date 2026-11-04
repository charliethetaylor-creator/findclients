/* FindClients research desk. Uses the existing dashboard auth and UI helpers. */
let leadData = [], leadSelected = null, leadLoaded = false, leadBusy = false;
const leadStages = ['new','shortlisted','contacted','replied','interested','sold','archived','do_not_contact'];
function leadResearchPriority(l) { const match=(l.notes||'').match(/^Priority: ([123])/m); return match ? ['','First look','Secondary','Stretch'][Number(match[1])] : ''; }
const leadLabel = s => String(s || '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const leadPath = id => '/api/leads/' + encodeURIComponent(id);
const leadLink = (url, label) => safeHref(url) ? '<a href="' + safeHref(url) + '" target="_blank" rel="noopener noreferrer">' + escHtml(label || url) + ' ↗</a>' : escHtml(label || url);

async function leadRequest(path, method, body) {
  const response = await authFetch(path, {method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) await lockIfRefused(response);
  if (!response.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map(e => e.msg).join('; ') : (data.detail || data.error);
    throw new Error(detail || 'The action could not be completed.');
  }
  return data;
}
async function leadAction(action) {
  if (leadBusy) return;
  leadBusy = true;
  const status = document.getElementById('lead-action-status');
  if (status) status.textContent = 'Working…';
  try { await action(); if (status) status.textContent = ''; }
  catch (error) { showToast(error.message || 'Could not complete the action.', 'error'); if(status) status.textContent = error.message; }
  finally { leadBusy = false; }
}
async function loadLeads(refreshDetail = false) {
  const data = await api('/api/leads');
  if (!data || !Array.isArray(data.leads)) {
    document.getElementById('lead-board').innerHTML = offlineState(); return;
  }
  leadData = data.leads;
  leadLoaded = true;
  const m = data.metrics;
  const checked = leadData.filter(l => l.evidence.some(e => e.confirmed) && !l.suppressed).length;
  document.getElementById('lead-metrics').innerHTML = [
    [leadData.length, 'Companies found'], [checked, 'With checked evidence'],
    [m.contacted_at, 'Manually contacted'], [m.replied_at, 'Replies recorded']
  ].map(([value,label])=>'<div class="lead-metric"><strong>'+value+'</strong><span>'+label+'</span></div>').join('');
  const rate = m.contacted_at ? (m.replied_at / m.contacted_at * 100).toFixed(1) + '%' : '—';
  document.getElementById('lead-outcomes').textContent = 'Company reply rate: ' + rate + ' · Positive replies: ' + m.interested_at + '. Outcomes are recorded by you; no messages are sent or monitored here.';
  renderLeadBoard();
  if(refreshDetail && leadSelected && document.getElementById('lead-dialog').open) renderLeadDetail();
  if (!document.getElementById('lead-product-name').dataset.loaded) {
    const product = await api('/api/leads/product');
    if (product) {
      document.getElementById('lead-product-name').value = product.name === 'Your Product' ? '' : product.name;
      document.getElementById('lead-product-description').value = product.description.startsWith('Describe what') ? '' : product.description;
      document.getElementById('lead-product-customer').value = product.customer;
      document.getElementById('lead-product-name').dataset.loaded = 'true';
    }
  }
}
function renderLeadBoard() {
  const query = document.getElementById('lead-search').value.toLowerCase().trim();
  const stage = document.getElementById('lead-filter-stage').value;
  const checked = document.getElementById('lead-filter-checked').checked;
  const items = leadData.filter(l => (!stage || l.stage === stage) && (!checked || l.evidence.some(e=>e.confirmed)) &&
    (l.name+' '+l.website+' '+l.industry+' '+l.notes+' '+l.contacts.map(c=>c.first_name+' '+c.last_name).join(' ')).toLowerCase().includes(query));
  document.getElementById('lead-count').textContent = items.length + ' of ' + leadData.length + ' companies';
  const board = document.getElementById('lead-board');
  if(!items.length) {
    board.innerHTML = '<div class="card lead-empty"><h3>' + (leadData.length ? 'No matching prospects' : 'Start with one real business') + '</h3><p>' +
      (leadData.length ? 'Try another filter.' : 'Add a company below, or use Discover to find companies. Research the ones that might benefit from your product, then check the evidence before drafting.') + '</p></div>';
    return;
  }
  board.innerHTML = items.map(l => {
    const e = l.evidence.find(e=>e.confirmed) || l.evidence[0];
    const checkedCount = l.evidence.filter(e=>e.confirmed).length;
    const phone=(l.public_contacts||[]).find(p=>p.kind==='phone');
    const priority=leadResearchPriority(l);
    return '<button class="lead-tile" onclick="openLead('+jsq(l.id)+')">'+
      '<div class="lead-tile-top"><span class="lead-stage">'+escHtml(leadLabel(l.stage))+'</span><span class="hint">'+(l.score ? 'Fit '+l.score+'/100' : 'Fit not assessed')+'</span></div>'+
      (priority?'<div class="lead-priority">'+escHtml(priority)+'</div>':'')+
      '<h3>'+escHtml(l.name)+'</h3><p class="lead-domain">'+escHtml(l.website || l.industry || 'No website recorded')+'</p>'+
      '<div class="lead-hook">'+(e ? '“'+escHtml(e.quote.slice(0,180))+(e.quote.length>180?'…':'')+'”' : 'No specific evidence yet. Research this business to look for a useful conversation starter.')+'</div>'+
      (phone?'<p class="lead-phone">'+escHtml(phone.value)+' <span class="hint">Business line</span></p>':'')+
      (l.draft?'<p class="lead-draft-ready">Message drafted · review before sending</p>':'')+
      '<div class="lead-tile-bottom"><span>'+checkedCount+' checked · '+l.evidence.length+' sourced details</span><span>'+ (l.suppressed ? 'Do not contact' : l.asking_price != null ? '£'+Number(l.asking_price).toFixed(2) : 'Open research →')+'</span></div></button>';
  }).join('');
}
function openLead(id) {
  leadSelected = id;
  renderLeadDetail();
  const dialog = document.getElementById('lead-dialog');
  if (!dialog.open) dialog.showModal();
}
function closeLead() { document.getElementById('lead-dialog').close(); }
function renderLeadDetail() {
  const l = leadData.find(l=>l.id===leadSelected);
  if(!l) return;
  document.getElementById('lead-detail').innerHTML = '<div class="lead-detail-head"><div><span class="eyebrow">PROSPECT RESEARCH</span><h2>'+escHtml(l.name)+'</h2>'+leadLink(l.website,'Company website')+'</div><button class="btn btn-secondary" onclick="closeLead()" aria-label="Close prospect">Close</button></div>'+
    '<p class="lead-notice">A researched prospect is not an interested buyer or a qualified lead. '+(l.suppressed?'<strong>Do not contact: this record is suppressed.</strong>':'Check business fit, identity and relevance before using the research.')+'</p>'+
    '<div class="lead-detail-grid"><div><section class="card"><h3>Find a specific reason to talk</h3><p>Reads up to six public website pages, looks for named people and published contact routes, and selects exact excerpts. Uses your configured AI subscription.</p>'+
    '<label class="lead-checkbox"><input type="checkbox" id="lead-web-search"> Also find review and professional profile links (2 Serper searches; provider credits may apply)</label>'+
    '<button class="btn btn-primary" onclick="startLeadResearch()" '+(['running','queued'].includes(l.research_status)?'disabled':'')+'>'+(['running','queued'].includes(l.research_status)?'Research running…':'Research this company')+'</button>'+
    '<span class="hint"> '+escHtml(leadLabel(l.research_status))+'</span>'+(l.research_error?'<p class="lead-warning">'+escHtml(l.research_error)+'</p>':'')+'</section>'+
    '<section class="card"><h3>Evidence & conversation hooks</h3><p>Confirm you checked the source, the company/person is correct and the detail is relevant. Checking it does not prove buying intent.</p>'+ (l.evidence.length ? l.evidence.map(e=>
      '<article class="lead-evidence"><div class="lead-tile-top"><span class="lead-stage">'+escHtml(leadLabel(e.kind))+'</span><span class="hint">'+(e.confirmed?'Source checked':'Needs checking')+'</span></div><blockquote>'+escHtml(e.quote)+'</blockquote><p>'+escHtml(e.relevance)+'</p>'+leadLink(e.url,'Open original source')+
      '<p class="hint">Published: '+escHtml(e.published_at||'date unknown')+' · Added '+escHtml(e.retrieved_at.slice(0,10))+'</p><div class="lead-buttons"><button class="btn btn-secondary btn-sm" onclick="confirmLeadEvidence('+jsq(e.id)+','+!e.confirmed+')">'+(e.confirmed?'Withdraw check':'I checked this evidence')+'</button>'+
      '<button class="btn btn-primary btn-sm" '+(!e.confirmed || l.suppressed?'disabled':'')+' onclick="draftLeadMessage('+jsq(e.id)+')">Draft from this detail</button></div></article>').join('') : '<p class="lead-empty-copy">No evidence recorded. Research the website or add an exact excerpt below.</p>')+'</section>'+
    '<details class="card"><summary>Add a review, owner reply or professional post</summary><p>Use public, business-relevant information. For a review and owner reply, add separate excerpts so their authorship stays clear. Do not add private life details or sensitive information.</p>'+
    '<form onsubmit="addLeadEvidence(event)"><label class="form-label" for="lead-evidence-url">Exact source link</label><input class="form-input" id="lead-evidence-url" type="url" required placeholder="https://…">'+
    '<label class="form-label" for="lead-evidence-kind">Source type</label><select class="form-input" id="lead-evidence-kind"><option value="review">Customer review</option><option value="owner_reply">Business owner’s reply</option><option value="professional_post">Professional social post</option><option value="website">Company website</option></select>'+
    '<label class="form-label" for="lead-evidence-quote">Exact excerpt</label><textarea class="form-input" id="lead-evidence-quote" minlength="15" maxlength="2000" required rows="4"></textarea>'+
    '<label class="form-label" for="lead-evidence-date">Published date, if shown</label><input class="form-input" id="lead-evidence-date" type="date">'+
    '<label class="form-label" for="lead-evidence-relevance">Why might this matter for the product?</label><textarea class="form-input" id="lead-evidence-relevance" maxlength="1000" rows="2"></textarea><button class="btn btn-primary" type="submit">Add evidence for review</button></form></details>'+
    '<section class="card"><h3>Sources to check</h3>'+(l.sources.length ? l.sources.slice(0,40).map(s=>'<div class="lead-source">'+leadLink(s.url)+'<span class="lead-stage">'+escHtml(leadLabel(s.status))+'</span><p class="hint">'+escHtml(s.detail)+'</p></div>').join('') : '<p>Research will put discovered source links here. Review sites and socials are marked for manual review, never silently treated as read.</p>')+'</section></div>'+
    '<aside><section class="card"><h3>Your opening message</h3><label class="form-label" for="lead-channel">Draft format</label><select class="form-input" id="lead-channel"><option value="dm">Direct message</option><option value="sms">SMS</option><option value="email">Short email</option></select><p class="hint">Choose a checked detail on the left. Every draft needs your judgement; nothing is sent.</p><textarea class="form-input" id="lead-draft" rows="7" placeholder="Your sourced draft will appear here. You can edit it before copying.">'+escHtml(l.draft||'')+'</textarea><button class="btn btn-secondary" onclick="copyLeadDraft()">Copy message</button><p class="hint">Edits in this box are for copying. CSV exports contain the generated draft.</p></section>'+
    '<section class="card"><h3>Contact routes</h3>'+leadContacts(l)+'</section>'+
    '<section class="card"><h3>Your progress</h3><button class="btn btn-secondary btn-sm" onclick="exportLeadResearch(leadSelected)">Export this checked record</button><form onsubmit="saveLeadProgress(event)"><label class="form-label" for="lead-stage">Stage</label><select class="form-input" id="lead-stage">'+leadStages.map(s=>'<option value="'+s+'" '+(s===l.stage?'selected':'')+'>'+leadLabel(s)+'</option>').join('')+'</select><label class="form-label" for="lead-price">Asking price for the record (£, optional)</label><input class="form-input" id="lead-price" type="number" step="0.01" min="0" max="100000" value="'+(l.asking_price??'')+'"><label class="form-label" for="lead-notes">Notes</label><textarea class="form-input" id="lead-notes" maxlength="5000" rows="4">'+escHtml(l.notes)+'</textarea><button class="btn btn-primary" type="submit">Save progress</button></form><p class="hint">Stages are your records, not verified sales. Reply metrics keep the history when you move a card.</p></section></aside></div>';
}
function leadContacts(l) {
  const contacts = l.contacts.map(p=>'<p><strong>'+escHtml((p.first_name+' '+p.last_name).trim() || 'Company contact')+'</strong><br>'+escHtml(p.title||'')+'<br>'+escHtml(p.email||'No email found')+' <span class="hint">'+escHtml(p.email_status||'Unverified')+'</span></p>');
  const publicRoutes = (l.public_contacts||[]).map(p=>'<p><strong>'+escHtml(p.value)+'</strong><br><span class="hint">'+escHtml(p.label)+'</span><br>'+leadLink(p.source_url,'Source')+'</p>');
  return contacts.concat(publicRoutes).join('') || '<p>No contact recorded yet. Research may find names or published addresses; it does not invent them.</p>';
}
function startLeadResearch() { leadAction(async()=>{await leadRequest(leadPath(leadSelected)+'/research','POST',{search_web:document.getElementById('lead-web-search').checked});await loadLeads(true);}); }
function confirmLeadEvidence(id,confirmed) { leadAction(async()=>{await leadRequest(leadPath(leadSelected)+'/evidence/'+encodeURIComponent(id),'PATCH',{confirmed});await loadLeads(true);}); }
function addLeadEvidence(event) {event.preventDefault();leadAction(async()=>{await leadRequest(leadPath(leadSelected)+'/evidence','POST',{
 url:document.getElementById('lead-evidence-url').value,quote:document.getElementById('lead-evidence-quote').value,kind:document.getElementById('lead-evidence-kind').value,
 published_at:document.getElementById('lead-evidence-date').value,relevance:document.getElementById('lead-evidence-relevance').value});await loadLeads(true);});}
function draftLeadMessage(evidence_id) {leadAction(async()=>{showToast('Drafting from your checked evidence…','success');const data=await leadRequest(leadPath(leadSelected)+'/draft','POST',{evidence_id,channel:document.getElementById('lead-channel').value});
 document.getElementById('lead-draft').value=data.message;await loadLeads();showToast('Draft ready to review. Nothing was sent.','success');});}
function copyLeadDraft() {leadAction(async()=>{const text=document.getElementById('lead-draft').value.trim();if(!text)throw new Error('Generate or write a message first.');await navigator.clipboard.writeText(text);showToast('Copied. Review it before contacting the prospect.','success');});}
function saveLeadProgress(event){event.preventDefault();leadAction(async()=>{const price=document.getElementById('lead-price').value;await leadRequest(leadPath(leadSelected),'PATCH',{
 stage:document.getElementById('lead-stage').value,notes:document.getElementById('lead-notes').value,asking_price:price===''?null:Number(price)});await loadLeads(true);showToast('Progress saved.','success');});}
function addLeadCompany(event){event.preventDefault();leadAction(async()=>{const data=await leadRequest('/api/leads','POST',{name:document.getElementById('lead-new-name').value,website:document.getElementById('lead-new-website').value});event.target.reset();await loadLeads();openLead(data.id);});}
function saveLeadProduct(event){event.preventDefault();leadAction(async()=>{await leadRequest('/api/leads/product','POST',{name:document.getElementById('lead-product-name').value,description:document.getElementById('lead-product-description').value,customer:document.getElementById('lead-product-customer').value});await loadLeads(true);showToast('Product saved. Recheck evidence before drafting for it.','success');});}
function exportLeadResearch(id=''){leadAction(async()=>{const response=await authFetch('/api/leads/export.csv'+(id?'?lead_id='+encodeURIComponent(id):''));if(!response.ok)throw new Error('Could not export research.');const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='researched-prospects.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
// Poll job status without replacing notes, forms or copied-message edits.
setInterval(async()=>{
 if(document.hidden || currentTab!=='leads' || leadBusy || !leadData.some(l=>['running','queued'].includes(l.research_status)))return;
 const before=leadData.find(l=>l.id===leadSelected)?.research_status;
 await loadLeads();
 const after=leadData.find(l=>l.id===leadSelected)?.research_status;
 if(before!==after && document.getElementById('lead-dialog').open) {
  // Keep user inputs intact when a background research job finishes.
  const saved = {};
  document.querySelectorAll('#lead-dialog input, #lead-dialog textarea, #lead-dialog select').forEach(el=>saved[el.id]=el.type==='checkbox'?el.checked:el.value);
  renderLeadDetail();
  Object.entries(saved).forEach(([id,value])=>{const el=document.getElementById(id);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value;}});
 }
},4000);
async function loadLeadSettings(){
 const settings=await api('/api/settings');
 const brain=await api('/api/leads/brain');
 if(settings)document.getElementById('lead-serper-key').placeholder=settings.serper_api_key_set?'Saved — enter new key to change':'Optional';
 if(brain){document.getElementById('lead-brain-provider').value=brain.provider;document.getElementById('lead-brain-model').value=brain.model;}
}
function saveLeadSearchKey(event){event.preventDefault();leadAction(async()=>{const el=document.getElementById('lead-serper-key');if(!el.value.trim())throw new Error('Enter a key to save.');await leadRequest('/api/settings/env','POST',{SERPER_API_KEY:el.value.trim()});el.value='';await loadLeadSettings();showToast('Search key saved locally.','success');});}
function saveLeadBrain(event){event.preventDefault();leadAction(async()=>{await leadRequest('/api/leads/brain','POST',{provider:document.getElementById('lead-brain-provider').value,model:document.getElementById('lead-brain-model').value});showToast('AI settings saved. The provider must already be logged in.','success');});}
