/**
 * Rebirth Auto — Business Knowledge Base (DEGRADED FALLBACK)
 * ------------------------------------------------------------------
 * As of the inventory/business-facts grounding work, the SOURCE OF TRUTH for
 * business facts is the Sanity `businessInfo` document (see
 * src/chatbot/grounding/business-facts.ts). This string is now only the
 * DEGRADED FALLBACK, used verbatim when that document is absent or the fetch
 * fails — so the chatbot always has something coherent to say. Keep it.
 *
 * Keep it a single exported string. The operational facts below (services,
 * opening hours, brands) are realistic dealer information, but the identifying
 * details (business name, phone, address, website) are FICTIONAL DEMO
 * PLACEHOLDERS — this is not a real business. It deliberately contains NO
 * specific vehicle stock or prices; live inventory is grounded separately. If
 * the dealership's real details are ever wired in, update this text (or the
 * Sanity businessInfo document).
 */

export const BUSINESS_KNOWLEDGE = `
# ABOUT REBIRTH AUTO

Rebirth Auto is a local multi-franchise car dealership. It sells new
and used cars and light commercial vehicles across a dozen new-car franchises,
and is known for its large vehicle range and customer service.

All of the group's new-car brands, plus service and parts, operate from a
single multipurpose facility, with ample on-site parking. Rebirth Auto
describes itself as a 'one stop' shop, with sales, service, parts, finance,
and car care and accessories departments all under one roof.

# BRANDS / FRANCHISES WE STOCK

Rebirth Auto represents the following new-vehicle brands, alongside a
Quality Used Cars department:
- Chery
- Honda
- Hyundai
- Isuzu UTE
- Jaecoo
- Jeep
- Kia
- LDV
- Leapmotor
- Nissan
- Ram
- Subaru

# WHAT WE DO (SERVICES)

Sales: New and pre-owned cars and light commercial vehicles across all of the
brands above, plus a Quality Used Cars range.

Service: An on-site service department servicing all makes and models — not
only the brands we sell. Manufacturer scheduled and interim servicing,
mechanical, electrical and air-conditioning repairs, wheel alignment and
balancing, disc rotor machining, tyre, safety and battery checks, fuel
injector servicing, and registration/safety work. A 1.5-hour Express Service
is available for faster turnaround. Technicians are factory-trained, use
manufacturer diagnostic equipment, and check every vehicle for outstanding
factory recalls and software updates. Services can be booked online per brand
or by phone.

Parts: Genuine parts supply through the on-site parts department.

Finance: The finance department compares packages from a range of Australia's
leading lenders to find competitive rates. Offerings include corporate and
consumer lending, extended warranty packages, comprehensive vehicle insurance,
loan payment protection, roadside assistance, and fully maintained lease
packages. Complete a finance enquiry to check eligibility. (Lending criteria,
fees, terms and conditions apply.)

Trade-ins / sell your vehicle: You can sell or trade in your current vehicle
towards your next car.

Car care and accessories: A dedicated department for new-car protection,
accessories, and vehicle care.

# OPENING HOURS

Sales department:
- Monday to Friday: 8:00 AM – 5:30 PM
- Saturday: 8:30 AM – 12:30 PM
- Sunday: Closed

Service and Parts departments:
- Monday to Friday: 8:00 AM – 5:00 PM
- Saturday & Sunday: Closed

(Hours can vary slightly by brand/department and on public holidays — confirm
by phone if it matters.)

# CONTACT

- Phone: (07) 5550 0100
- Address: 24 Riverside Drive, Rivertown QLD 4670
- Website / contact form: https://rebirthauto.com.au/contact
- Email: sales@rebirthauto.com.au
- You can also leave your details in this chat and we'll follow up.
`.trim();
