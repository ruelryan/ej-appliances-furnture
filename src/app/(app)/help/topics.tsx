import Link from "next/link";
import { SectionCard } from "@/components/section-card";
import type { Role } from "@/lib/supabase/server";

// The staff manual, one topic per page. Written for staff, not developers:
// plain language, concrete button names, no system jargon. The developer
// reference lives in docs/ in the repo; keep the two in sync when behavior
// changes (same standing rule as docs/).
//
// `roles` omitted = every authenticated role, same convention as nav-links.

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

function Points({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-card border-l-[3px] border-brand bg-brand/5 px-3 py-2 text-xs text-ink">
      <span className="font-semibold">Tip: </span>
      {children}
    </p>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
      {children}
    </p>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-sm text-ink">{children}</p>;
}

export interface HelpTopic {
  slug: string;
  title: string;
  sub: string;
  group: string;
  roles?: Role[];
  body: React.ReactNode;
}

const MANAGE: Role[] = ["owner", "admin", "staff"];

export const HELP_TOPICS: HelpTopic[] = [
  // ── Start here ──────────────────────────────────────────────
  {
    slug: "getting-started",
    title: "Getting started",
    sub: "Signing in, your role, and finding your way around",
    group: "Start here",
    body: (
      <>
        <SectionCard title="Signing in">
          <Points
            items={[
              <>
                The owner creates your account — there is no sign-up page. You
                get an email address and a starting password.
              </>,
              <>
                Change your password any time: tap your name at the top, then
                use the password form on the Account page.
              </>,
              <>
                If you cannot sign in, tell the owner — accounts can be
                deactivated, and only the owner can restore them.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard
          title="On your phone"
          sub="The app is built for phones — no installation needed."
        >
          <Points
            items={[
              <>
                Open the site in Chrome or Safari and choose{" "}
                <strong>Add to Home Screen</strong> — it then opens like an
                app.
              </>,
              <>
                The tabs at the bottom are your main pages. What you see
                depends on your role: a collector sees the worklist, an agent
                sees commissions, and so on.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="If something looks wrong">
          <P>
            Numbers on screen (balances, overdue amounts, due dates) are
            computed by the system and cannot be edited by hand. If a number
            looks wrong, the cause is a missing or mistaken record — a payment
            not yet posted, a wrong date. Tell the admin or owner; do not work
            around it.
          </P>
        </SectionCard>
      </>
    ),
  },
  {
    slug: "dtr",
    title: "Time record (DTR)",
    sub: "Clocking in and out, corrections, and holidays",
    group: "Start here",
    roles: ["owner", "admin", "collector", "delivery", "staff"],
    body: (
      <>
        <SectionCard title="Clocking in and out">
          <Points
            items={[
              <>
                Tap <strong>Clock in</strong> on the DTR page when you start,
                and <strong>Clock out</strong> when you leave. One in and one
                out per day.
              </>,
              <>
                Lunch (12:00–1:00) is deducted automatically — do not clock
                out for lunch.
              </>,
              <>
                Your phone will ask for your location. Allow it — punches are
                accepted only near the store.
              </>,
            ]}
          />
          <Warn>
            Forgetting to clock out blocks your payslip. Fix it with a
            correction request as soon as you notice.
          </Warn>
        </SectionCard>
        <SectionCard
          title="Corrections"
          sub="You cannot edit your own punches — request instead."
        >
          <Steps
            items={[
              <>
                On the DTR page choose <strong>Request correction</strong>,
                pick the date, enter the right times, and write the reason.
              </>,
              <>The owner approves or rejects it — you will see the result.</>,
              <>
                Working in the field all day (deliveries, collections trips)?
                You cannot punch away from the store — file a correction
                request for that day. That is the normal way, not an
                exception.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Holidays">
          <Points
            items={[
              <>
                Working on a <strong>regular holiday</strong> pays double;
                working on a <strong>special day</strong> pays an extra 30%.
              </>,
              <>
                A regular holiday you do not work still pays a normal day —
                on weekdays. Weekend holidays are paid only if you actually
                work.
              </>,
            ]}
          />
        </SectionCard>
      </>
    ),
  },
  {
    slug: "tasks",
    title: "Tasks",
    sub: "Assigning work and keeping the thread in one place",
    group: "Start here",
    body: (
      <>
        <SectionCard title="How tasks work">
          <Points
            items={[
              <>
                Anyone can create a task and assign it to a person or to a
                whole team (all admins, all collectors, …).
              </>,
              <>
                Link the task to a contract or customer when it is about one —
                whoever picks it up gets the context in one tap.
              </>,
              <>
                Use the comment thread on the task instead of side messages —
                the next person can read the whole story.
              </>,
              <>
                The red badge on the Tasks tab is your open count. Mark tasks
                done when finished — an old open task hides the real work.
              </>,
            ]}
          />
        </SectionCard>
      </>
    ),
  },

  // ── Sales and money ─────────────────────────────────────────
  {
    slug: "new-sale",
    title: "Recording a sale",
    sub: "New contracts, installment terms, and cash sales",
    group: "Sales and money",
    roles: MANAGE,
    body: (
      <>
        <SectionCard title="Creating the contract">
          <Steps
            items={[
              <>
                <strong>Customer</strong>: search first — most buyers are
                repeat customers. For a new customer, fill the address by
                picking the municipality and barangay from the list (this is
                what groups the account into a collector&rsquo;s route), and
                add a landmark.
              </>,
              <>
                <strong>Item</strong>: type in the product box and pick from
                the photo list. If the item is genuinely not there, add it on
                the spot — it will be double-checked later on the Products
                review page.
              </>,
              <>
                <strong>Terms</strong>: pick 4, 5, 6, or 12 months. The form
                shows the price, 25% downpayment, and monthly amount before
                you save. 4 and 5 months are Good-as-Cash — no markup.
              </>,
              <>
                <strong>Agent</strong>: pick the sales agent who brought the
                sale — their commission depends on it. Walk-ins with no agent
                are recorded as Office Sales.
              </>,
              <>
                Save, then <strong>print the contract</strong> and have it
                signed. The printed page includes the legally required
                financing disclosure — never hand-write a contract.
              </>,
            ]}
          />
          <Tip>
            A delivery entry is created automatically for every sale — the
            delivery team sees it without you doing anything.
          </Tip>
        </SectionCard>
        <SectionCard title="Cash sales">
          <P>
            Choose <strong>Cash</strong> on the same form. The customer pays
            the full cash price, there is no installment schedule, and the
            sale still goes through deliveries and (if an agent brought it)
            commissions like any other.
          </P>
        </SectionCard>
        <SectionCard title="After the sale">
          <Points
            items={[
              <>
                Ask the customer for their Messenger, and after the sale the
                admin creates the <strong>collection group chat</strong>
                (owner + admin + collector + customer) — both links are saved
                on the customer page.
              </>,
              <>
                The price and terms are locked once saved. If something was
                entered wrong, tell the owner — do not create a second
                contract.
              </>,
            ]}
          />
        </SectionCard>
      </>
    ),
  },
  {
    slug: "payments",
    title: "Payments and receipts",
    sub: "Recording money, printing receipts, fixing mistakes",
    group: "Sales and money",
    roles: MANAGE,
    body: (
      <>
        <SectionCard title="Recording a payment">
          <Steps
            items={[
              <>Find the contract, then choose New payment.</>,
              <>
                Enter the amount and date, the <strong>official receipt
                number</strong> from the booklet, and which booklet
                (Appliances or Furniture).
              </>,
              <>
                GCash payments: also record the customer&rsquo;s reference
                number. GCash is Ruel Ryan Rosal, 0906&nbsp;902&nbsp;9261 —
                always check the money actually arrived before recording.
              </>,
              <>
                Print the receipt from the payment page if the customer wants
                a printed copy.
              </>,
            ]}
          />
          <Tip>
            Cash a collector brought in is different — post it from the
            Collections page so it stays linked to the collector&rsquo;s
            visit. See the Collections topic.
          </Tip>
        </SectionCard>
        <SectionCard title="Mistakes">
          <Points
            items={[
              <>
                Payments are never deleted. A wrong payment is
                <strong> voided</strong> with a reason — it stays visible,
                struck through, and every balance updates by itself.
              </>,
              <>Voided by mistake? It can be restored. Ask the owner.</>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Following up">
          <P>
            Each contract shows its follow-up stage (on track, overdue, for
            demand) computed from the payment history. The contract page has
            a ready-made message to copy into Messenger — polite when
            slightly late, formal when seriously late. The owner decides
            anything beyond messages.
          </P>
        </SectionCard>
      </>
    ),
  },
  {
    slug: "customers",
    title: "Customers",
    sub: "The customer card, addresses, and Messenger links",
    group: "Sales and money",
    roles: MANAGE,
    body: (
      <>
        <SectionCard title="The customer card">
          <P>
            A customer&rsquo;s page shows every contract, total balance, and
            contact details in one place. Print the customer card before a
            field visit — it is the paper the collector carries.
          </P>
        </SectionCard>
        <SectionCard title="Addresses">
          <Points
            items={[
              <>
                Always pick the municipality and barangay from the list
                rather than typing freely — collector routes group by
                barangay, and a typo splits a route.
              </>,
              <>
                Add a landmark (&ldquo;near the barangay hall&rdquo;) — it is
                often worth more than the street name.
              </>,
              <>
                Collectors can pin the exact house location with GPS while at
                the door; the pin becomes the Directions link everyone uses
                after that.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="The two Messenger links">
          <Points
            items={[
              <>
                <strong>Personal Messenger</strong> — the customer&rsquo;s own
                profile, for office use.
              </>,
              <>
                <strong>Collection group chat</strong> — a chat with the
                owner, admin, collector, and customer together. The admin
                creates it after each sale. It is the only link collectors
                see, so collection talk always happens where the office can
                read it.
              </>,
            ]}
          />
          <Warn>
            Never discuss a customer&rsquo;s debt with anyone else — not a
            relative, not a neighbour, not in a comment. It is against the
            law even when it is true.
          </Warn>
        </SectionCard>
      </>
    ),
  },
  {
    slug: "products",
    title: "Products and stock",
    sub: "The catalog, stock counts, and the review queue",
    group: "Sales and money",
    roles: MANAGE,
    body: (
      <>
        <SectionCard title="The catalog">
          <Points
            items={[
              <>
                Every product has a photo, a selling price (it pre-fills the
                sale form), and a stock count. Keep photos and prices current
                — the sale form is only as good as the catalog.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Stock">
          <Points
            items={[
              <>
                Use <strong>Restock</strong> when stock arrives and{" "}
                <strong>Adjust</strong> to correct a count — every change is
                recorded with who and why.
              </>,
              <>
                Delivering an in-stock item lowers the count by itself —
                never adjust stock for a delivery manually.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard
          title="The review queue"
          sub="Items added in a hurry during a sale get checked here."
        >
          <Points
            items={[
              <>
                Each pending item is compared side by side with the closest
                existing products. If it is genuinely new,{" "}
                <strong>approve</strong> it.
              </>,
              <>
                If it duplicates an existing product, <strong>merge</strong>{" "}
                it — everything moves to the kept product.
              </>,
            ]}
          />
          <Warn>
            Merging is permanent and cannot be undone. When unsure, leave it
            pending and ask.
          </Warn>
        </SectionCard>
      </>
    ),
  },

  // ── Field work ──────────────────────────────────────────────
  {
    slug: "collections",
    title: "Collections",
    sub: "The worklist, logging visits, and posting the money",
    group: "Field work",
    roles: ["owner", "admin", "collector", "staff"],
    body: (
      <>
        <SectionCard title="For collectors: the worklist">
          <Points
            items={[
              <>
                Accounts that <strong>promised to pay today</strong> float to
                the top — visit those first. The rest group by barangay so a
                day&rsquo;s route stays in one area.
              </>,
              <>
                Log <strong>every</strong> visit the same day — collected,
                promised, nobody home, or refused. A promise needs a date; a
                cash collection needs your booklet receipt number; GCash needs
                the customer&rsquo;s reference.
              </>,
              <>
                Remit everything to the office by <strong>4:30 PM</strong> the
                same day, and check the report page — your cash on hand must
                match it to the peso.
              </>,
            ]}
          />
          <P>
            The full field manual — what to say at the door, in Cebuano, for
            every situation — is at{" "}
            <Link
              href="/collections/sop"
              className="font-semibold text-brand hover:underline"
            >
              How to collect
            </Link>
            .
          </P>
        </SectionCard>
        <SectionCard title="For the office: posting">
          <Steps
            items={[
              <>
                A collector&rsquo;s log entry is <strong>not yet a
                payment</strong>. The To-post list on the Collections page
                shows money waiting to be posted.
              </>,
              <>
                Post each entry after the cash is counted: add the official
                receipt number and booklet, and the payment lands on the
                contract.
              </>,
              <>
                A mistaken entry can be cancelled with a reason — but only
                before it is posted. After posting, it is a payment and
                follows the payment rules (void, never delete).
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Cash advances">
          <P>
            Gasoline and trip money are issued as a cash advance, receipts
            are logged against it, and it is closed when receipts plus
            returned cash match what was issued. Keep every receipt.
          </P>
        </SectionCard>
      </>
    ),
  },
  {
    slug: "deliveries",
    title: "Deliveries",
    sub: "From new sale to delivered, and what it does to stock",
    group: "Field work",
    roles: ["owner", "admin", "delivery", "staff"],
    body: (
      <>
        <SectionCard title="The queue">
          <Steps
            items={[
              <>
                Every sale appears here automatically. First answer: is the
                item in the office? Mark it <strong>In stock</strong> or{" "}
                <strong>To order</strong>.
              </>,
              <>
                For orders, the office records the supplier, cost, and — when
                it arrives — the invoice. An order waiting more than two
                weeks for its invoice gets flagged.
              </>,
              <>
                After handing the item to the customer, mark it{" "}
                <strong>Delivered</strong> with a note. If it came from
                office stock, the stock count drops by itself.
              </>,
            ]}
          />
          <Tip>
            Use the Directions link on each row — it opens the customer&rsquo;s
            pinned location, or their address if no pin exists yet. A{" "}
            <strong>~</strong> means it is approximate.
          </Tip>
        </SectionCard>
        <SectionCard title="Rules of thumb">
          <Points
            items={[
              <>
                Mark Delivered only when the item is actually with the
                customer — the date is part of the record.
              </>,
              <>
                A delivered entry cannot be edited. Wrong? Tell the admin or
                owner the same day.
              </>,
              <>
                A whole day on the road means you cannot clock in or out —
                file a DTR correction request for that day.
              </>,
            ]}
          />
        </SectionCard>
      </>
    ),
  },

  // ── Pay and commissions ─────────────────────────────────────
  {
    slug: "payroll",
    title: "Your payslip",
    sub: "Pay periods, deductions, and 13th-month pay",
    group: "Pay and commissions",
    body: (
      <>
        <SectionCard title="How pay works">
          <Points
            items={[
              <>
                Pay periods are the 1st–15th and 16th–end of month. Your pay
                comes from your DTR — hours actually punched, with holiday
                rates applied.
              </>,
              <>
                You see your own <strong>finalized</strong> payslips on the
                Payroll page; a slip being drafted is not visible yet.
              </>,
              <>
                SSS, PhilHealth, and Pag-IBIG are deducted once a month, on
                the 16th–end slip. The 1st–15th slip has no deductions.
              </>,
              <>
                Meal allowance is paid per day actually worked.
              </>,
            ]}
          />
          <Warn>
            A missing clock-out anywhere in the period blocks the payslip —
            fix punches with correction requests before payday.
          </Warn>
        </SectionCard>
        <SectionCard title="13th month">
          <P>
            13th-month pay is one twelfth of basic salary earned in the year,
            as the law defines it — holiday premiums and allowances are not
            part of the base. It accumulates from your finalized payslips;
            ask the owner where yours stands.
          </P>
        </SectionCard>
      </>
    ),
  },
  {
    slug: "commissions-leads",
    title: "Commissions and leads",
    sub: "For sales agents: your deals, your money, your leads",
    group: "Pay and commissions",
    roles: ["owner", "admin", "sales_agent", "staff"],
    body: (
      <>
        <SectionCard title="How commissions work">
          <Points
            items={[
              <>
                Your commission is <strong>10% of the cash price</strong> of
                each sale you brought, fixed the moment the sale is recorded.
              </>,
              <>
                It becomes payable when the customer completes the{" "}
                <strong>downpayment</strong> — the Commissions page shows each
                deal as pending, payable, or paid.
              </>,
              <>
                At payout, print your commission statement — it lists what is
                payable now and is signed by you and the owner.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Leads">
          <Steps
            items={[
              <>
                Found a buyer? Submit a lead with their name, contact, and the
                item — the office takes it from there.
              </>,
              <>
                If it becomes a sale, the contract is credited to you and the
                commission follows automatically.
              </>,
              <>
                If it is rejected you will see the reason — that is feedback,
                not a penalty.
              </>,
            ]}
          />
          <Tip>
            You see only your own deals, customers, and commissions — other
            agents&rsquo; information is not visible to you, nor yours to
            them.
          </Tip>
        </SectionCard>
      </>
    ),
  },

  // ── Owner ───────────────────────────────────────────────────
  {
    slug: "owner",
    title: "Owner controls",
    sub: "Accounts, closing, repossession, repricing, and reports",
    group: "Owner",
    roles: ["owner"],
    body: (
      <>
        <SectionCard title="Accounts and settings">
          <Points
            items={[
              <>
                Create staff accounts on Admin; deactivate instead of
                deleting when someone leaves. Hourly rates, government
                contribution amounts, and meal allowance are set in DTR
                settings — staff cannot see each other&rsquo;s pay.
              </>,
              <>
                DTR settings also hold the holiday calendar (add newly
                proclaimed holidays each year) and the clock-in locations.
                Removing all locations switches the location check off.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Contracts only you can touch">
          <Points
            items={[
              <>
                <strong>Closing</strong> a fully settled contract removes it
                from every worklist.
              </>,
              <>
                <strong>Repossession</strong> moves in stages — letter
                prepared, letter sent, for pullout, repossessed — and each
                step is your explicit call. Taking the item back legally
                cancels the sale and ends the debt; when in doubt, ask the
                lawyer first.
              </>,
              <>
                <strong>Repricing</strong> a lapsed Good-as-Cash contract to
                6 or 12 months needs the customer&rsquo;s signature on the
                printed amendment before it takes effect. It never changes
                the downpayment or the agent&rsquo;s commission.
              </>,
              <>
                <strong>Voided payments</strong> can be restored, and demand
                letters print from the contract page with the 15-day notice.
              </>,
            ]}
          />
        </SectionCard>
        <SectionCard title="Reports and safety nets">
          <Points
            items={[
              <>
                Analytics shows sales, collections against expected, agent
                performance, and aging. CSV exports of every dataset are on
                the same pages.
              </>,
              <>
                Accounts that have <strong>never paid anything</strong> do
                not escalate to the demand stage by themselves — review them
                by hand now and then.
              </>,
              <>
                Before anything risky, take a database backup — ask for a
                fresh one rather than assuming the last one is recent.
              </>,
            ]}
          />
        </SectionCard>
      </>
    ),
  },
];

export function topicsFor(role: Role): HelpTopic[] {
  return HELP_TOPICS.filter((t) => !t.roles || t.roles.includes(role));
}
