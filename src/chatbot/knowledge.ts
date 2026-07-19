/**
 * Astro Motors — Business Knowledge Base (DEMO STUB)
 * ------------------------------------------------------------------
 * This is a placeholder knowledge base for the demo dealership "Astro Motors".
 * It exists only to prove the chatbot plumbing works end-to-end. Real content
 * will come from Sanity later (see the wider port plan).
 *
 * Injected verbatim into the system prompt at request time (system-prompt.ts).
 * Keep it a single exported string. All specifics below are placeholders —
 * search for [DEALER_PHONE] / [DEALER_URL] and the TODO markers to fill in.
 */

export const BUSINESS_KNOWLEDGE = `
# ABOUT ASTRO MOTORS

Astro Motors is a demo car dealership used to showcase this listings template.
We present ourselves as a friendly local dealership selling quality new and
used vehicles, with everything a buyer needs under one roof.

# WHAT WE DO (SERVICES)

Sales: We sell a rotating range of new and pre-owned cars, SUVs, utes, and
vans. Every used vehicle is inspection-checked before it goes on the lot, and
listings on the site show the key details (price, kilometres, year, and photos).

Financing: We can help arrange finance for approved buyers, including
pre-approval so you know your budget before you shop. We work with a panel of
lenders to find a repayment plan that suits you. (Lending criteria, fees, and
terms and conditions apply.)

Service department: Our on-site workshop handles logbook servicing, repairs,
tyres, and safety inspections for most makes and models — not just cars bought
from us. Bookings can be made by phone or through the contact page.

Trade-ins: Bring your current vehicle in for a free, no-obligation valuation.
A trade-in can go straight towards your next car to reduce what you finance or
pay up front.

# PRICING

Advertised prices are a guide and may change. Drive-away pricing, on-road costs,
government charges, and any dealer options are confirmed in writing before you
buy. Ask us for a full quote on any listing — we're happy to break down the
numbers. (Placeholder pricing note — real figures come from the live listings.)

# TERMS & CONDITIONS

This is a demo. Any offers, warranties, finance terms, and vehicle availability
described here are placeholders and are not real commitments. Full terms and
conditions will be published on the live site. TODO: replace with the
dealership's actual T&Cs and warranty policy.

# OPENING HOURS

TODO: replace with the dealership's real trading hours. Placeholder hours:
- Monday to Friday: 8:30am – 5:30pm
- Saturday: 9:00am – 4:00pm
- Sunday & public holidays: Closed
Service department bookings close 30 minutes before the showroom.

# CONTACT

- Phone: [DEALER_PHONE]
- Website / contact form: [DEALER_URL]/contact
- You can also leave your details in this chat and we'll follow up.
`.trim();
