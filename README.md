# FindClients — researched prospects, manual conversations

This fork adapts Harvey into a local research desk. The **Leads** page is the default dashboard page. It does not send email, SMS or social messages, and does not handle your inbox. Upstream sales automation is retained as historical code but disabled at the heartbeat, dashboard actions and sending integrations. Old credentials or queued campaigns do not re-enable sending.

## Start

Use Python 3.11 or later. Open **Start FindClients.command** on macOS, or:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/harvey dashboard
```

Use the private unlock link printed by the dashboard. It listens on your machine only. The package/command is still named `harvey` to preserve the existing installation and database.

## Research workflow

1. On Leads, describe the actual product and customer you are researching for. This version has **one active product**, not separate client workspaces. Saving a product clears previous generated drafts and withdraws evidence checks, but retains evidence and notes. Before reusing a company for a different product, reassess the fit and evidence relevance; historical scores are not recalculated automatically.
2. Add a company manually, or use the existing Discover and Signals pages. Discovery providers and their credits/coverage still apply.
3. Open its card and request research. Up to six company website pages are read with public-network checks, a robots.txt check and request/size/time limits. It finds named staff and published email routes without guessing that an address belongs to a person. Published emails are unverified.
4. AI selects specific exact excerpts, with source links, retrieval dates and tentative relevance. Unsupported quotations and URLs are rejected. No specific fact means no invented hook. AI-selected dates and relevance still need checking; retrieval time is not publication time.
5. Public review and professional-profile links found on the site are recorded for **manual review**. An optional search uses **two Serper queries** to find further links (configure a key in Settings; credits may apply). Search snippets are not evidence. This version does not automatically read Google reviews or owner social feeds, bypass logins or CAPTCHAs, or establish profile ownership. Paste a specific public excerpt and exact link where needed. Keep a review and the owner's reply separate.
6. Check that an excerpt is accurate, belongs to the right business/person, and relates to the product before confirming it. Human confirmation is not independent verification. Only confirmed evidence can support an AI draft. Choose SMS, DM or email; each draft is a short suggested opening, never sent. Review and edit it before copying. Edits in the copy box are not persisted; exports use the generated draft.
7. Record manual contact, replies, interest, or a record sale. Asking price is an optional GBP note, not a valuation or payment. Metrics reflect your entries, not monitored messages or verified revenue. Moving a card backwards retains its contact/reply history.
8. Export checked prospects as CSV, either the full checked list or a single company record. The new export includes evidence and provenance, contact routes, fit scores where available, the generated draft, asking price and notes. It excludes unconfirmed records, archived records, opt-outs and configured do-not-contact matches. It escapes spreadsheet-formula prefixes. The original Contacts/CLI export remains a separate legacy raw prospect export.

## Costs and limitations

Website reading has no paid search call. Evidence selection uses one configured Claude Code or Codex model call, and each requested draft adds another; retries and provider limits may apply. The selected CLI must already be installed and logged in. Configure the provider/model in Settings. No AI login, paid service, mailbox, outbound research or live campaign has been configured or validated for your account merely by installing this fork.

AI analysis sends research text to the selected AI provider. Optional search sends company/person search terms to Serper. Data is stored locally in the existing SQLite database, with additional lead workflow, source, public-contact and evidence tables. Back up `data/` and local configuration. Do not commit customer data, `.env`, credentials or `harvey.local.yaml`.

Use public, business-relevant information. Avoid private life details or sensitive traits. Reviews are attributed feedback, not established facts about an entire business. Nothing here proves demand, buying intent, a qualified lead, a booked meeting or a customer, and no reply-rate improvement is promised. Formal business, contracts, payments and privacy decisions are handled by the user's parent/guardian.

## Verification

```sh
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m pytest -q tests/test_leads_desk.py
```

Tests use temporary databases and mocked external/AI calls. Old upstream tests that expect successful automatic sending describe a feature intentionally disabled in this fork. See `docs/UPSTREAM_HARVEY.md` for historical upstream documentation, not current setup instructions.

MIT licence and original attribution retained; external service/data terms remain separate.
