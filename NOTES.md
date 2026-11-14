# Owner verification notes

## Facts supplied for this system

These are requester-provided details and have not been independently confirmed:

- Property name: Aster Suites.
- Location text: Awasi, Kisumu.
- Address text: `R3PG+6VQ, Awasi`.
- Phone: `0724 266808`; WhatsApp uses `254724266808`.
- Room categories supplied: single rooms, double/twin rooms, and double rooms with private bathrooms.
- The supplied listing summary mentioned private bathrooms, flat-screen TVs, and inner-courtyard views, but their availability by room is unconfirmed.
- Booking.com listing supplied as a reference: [Aster Suites on Booking.com](https://www.booking.com/hotel/ke/aster-suites-awasi-kisumu-kisumu1.en-gb.html). Its header was reviewed for layout inspiration; property facts and room details have not been independently verified.

## Unconfirmed information to verify or replace

- Room names, inventory counts, capacities, bed configuration, sizes, bathroom assignments, televisions, views, and every rate.
- Menu items, ingredients, dietary information, prices, hours, and whether meals are provided.
- Payment policy, deposits, cancellation terms, check-in/out times, and staff workflows.
- Exact street address/map pin, directions, and nearby landmarks.
- Amenities (including Wi-Fi, parking, hot water, breakfast, or security).
- Email, opening hours, official social links, and guest contact/retention practices.
- Real review quotes and publication consent. No guest reviews are seeded or fabricated.
- No official Google Business Profile or public Google review page could be verified from the searches available. The homepage only displays approved reviews whose source is marked as Google in the staff dashboard; provide the exact Google Maps profile URL or Place ID before adding a direct profile embed.
- M-Pesa sandbox credentials and callback setup. No real payment credentials or live endpoint should be added.
- Google OAuth web-client ID, client secret, authorized callback URL, consent-screen configuration, and production privacy/retention policy.
- OAuth code and callback handling are implemented, but Google sign-in remains disabled until the owner creates a Google Cloud web client and configures its credentials in the untracked `.env` file.

Seeded room and meal details are unconfirmed. Public availability and meal ordering remain unavailable until an owner confirms the relevant listings.

## Photos

Eighteen JPEG photos were supplied in the workspace `images` folder and copied into `public/images/` with descriptive filenames. The pictures appear to depict Aster Suites and its signage, but the original source and commercial-use permission cannot be established from the files. **Owner permission and photo credits are pending.** See [PHOTO_CREDITS.md](./PHOTO_CREDITS.md).

## Local-only status

The Node/Express app and Prisma schema are implemented. The included Docker Compose service is PostgreSQL 16. Docker Desktop was unavailable during validation; a temporary isolated PostgreSQL 16 cluster was used for migrations, seed and tests. The project was not deployed.
