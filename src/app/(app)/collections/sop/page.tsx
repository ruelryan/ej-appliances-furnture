import { redirect } from "next/navigation";
import { getProfile, canPostPayments } from "@/lib/supabase/server";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

// Field reference for collectors — the printed SOP, on a phone. Deliberately
// reached from the Worklist header rather than a nav tab: a collector's mobile
// tab bar is already at 5 of its 6 slots.

function Script({ bis, en }: { bis: string; en: string }) {
  return (
    <div className="mb-2 rounded-card border-l-[3px] border-brand bg-brand/5 px-3 py-2">
      <p className="text-sm italic text-ink">&ldquo;{bis}&rdquo;</p>
      <p className="mt-0.5 text-xs text-muted">{en}</p>
    </div>
  );
}

function Log({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 rounded-card border-l-[3px] border-positive bg-surface px-3 py-2 text-xs text-positive-dark">
      <span className="font-semibold">Log: </span>
      {children}
    </p>
  );
}

export default async function CollectionSopPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const allowed =
    profile.role === "collector" || canPostPayments(profile.role);
  if (!allowed) redirect("/");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> How to collect
        </h1>
        <p className="mt-1 text-sm text-muted">
          What to say, what to do, and what to record on every visit.
        </p>
      </div>

      <SectionCard title="Never break these" sub="Everything else is technique. These are not.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
          <li>
            <strong>No receipt, no money.</strong> Write the booklet receipt in front of the
            customer before the cash goes in your bag.
          </li>
          <li>
            <strong>Remit everything by 4:30 PM</strong>, same day. Cash never goes home with you.
          </li>
          <li>
            <strong>Never discuss the account with anyone but the customer</strong> — not a
            neighbour, not a relative. That is a privacy violation even when it is true.
          </li>
          <li><strong>Visit only between 6:00 AM and 10:00 PM.</strong></li>
          <li>
            <strong>Never threaten repossession, court, or jail.</strong> Only the owner decides
            those, and threatening what we will not do is itself prohibited.
          </li>
          <li><strong>Never raise your voice, insult, or shame anyone</strong> — least of all online.</li>
          <li><strong>Log every visit the same day</strong>, including the ones that collected nothing.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Opening the visit" sub="How you start decides most of what follows.">
        <Script
          bis="Maayong buntag po. Ako si ______, taga E & J Appliances Furniture. Naa ba si Ginoong/Ginang ______?"
          en="Good morning. I'm ______ from E & J Appliances Furniture. Is Mr/Mrs ______ here?"
        />
        <p className="mb-2 text-sm text-ink">
          Once you have the right person, and away from other people:
        </p>
        <Script
          bis="Mahitungod ni sa inyong account sa E & J. Wala ko diri aron mangaway — ania ko para matabangan ta ka nga ma-ayos ni. Pwede ta mag-istorya kadali?"
          en="This is about your account with E & J. I'm not here to argue — I'm here to help sort this out. Can we talk a moment?"
        />
        <p className="text-xs text-muted">
          Never open with the amount. Establish who you are, then ask — don&rsquo;t announce.
        </p>
      </SectionCard>

      <SectionCard title="They pay" sub="Full or partial — always accept what is offered.">
        <Script
          bis="Salamat kaayo. Ania ang imong resibo — palihug tan-awa ang numero ug ang kantidad kung sakto."
          en="Thank you. Here is your receipt — please check the number and amount are correct."
        />
        <Log>
          <strong>Collected</strong> + amount + method. Cash needs your booklet number; GCash needs
          the customer&rsquo;s reference number.
        </Log>
        <p className="text-sm text-ink">
          For a partial payment, thank them first, then get a date for the rest:
        </p>
        <Script
          bis="Salamat sa imong bayad, dako ni'g tabang. Para sa nahibilin nga ______, kanus-a man nimo mahatag?"
          en="Thank you for this payment, it helps a lot. For the remaining ______, when can you give it?"
        />
      </SectionCard>

      <SectionCard title="&ldquo;I can't pay right now&rdquo;" sub="Find out which kind of can't it is.">
        <p className="mb-2 text-sm text-ink">
          Acknowledge first — never argue with the reason. Then ask an open question.
        </p>
        <Script
          bis="Nakasabot ko, lisod jud ang panahon karon. Pero para dili magdako imong balanse — unsa may kaya nimo karon, bisan gamay lang?"
          en="I understand, times are hard. But so your balance doesn't grow — what can you manage today, even a small amount?"
        />
        <Script
          bis="Sige, sabot ta. Kanus-a man ang pinaka-sigurado nga adlaw nga makabayad ka, ug pila?"
          en="All right, let's agree. What is the most certain day you can pay, and how much?"
        />
        <p className="text-xs text-muted">
          You may not waive interest, reduce the balance, or change the monthly. If they need that,
          say the owner must decide and that you will raise it.
        </p>
      </SectionCard>

      <SectionCard title="&ldquo;I'll pay on ______&rdquo;" sub="Vague is worthless. Get an amount and a day.">
        <Script
          bis="Sige. Aron klaro ta: ______ pesos sa ______. I-sulat nako ni ug balikan tika ana nga adlaw. Sakto ba?"
          en="All right. So we're clear: ______ pesos on ______. I'll write this down and come back that day. Correct?"
        />
        <Log>
          <strong>Promised to pay</strong> + the date. The account returns to the top of your
          worklist on that day — so go back.
        </Log>
      </SectionCard>

      <SectionCard title="Nobody is home" sub="You may ask when they'll return. Never why you're there.">
        <Script
          bis="Maayong buntag. Naa ba si ______? Kanus-a man siya mobalik? Palihug ingna nga miadto si ______ gikan sa E & J ug mobalik ko."
          en="Good morning. Is ______ here? When will they be back? Please tell them ______ from E & J came by and will return."
        />
        <p className="mb-2 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          Never tell anyone but the customer that they owe money, how much, or that you are
          collecting. Leave your name, the company, and nothing else.
        </p>
        <Log><strong>Not available</strong> — note the time and what you learned.</Log>
      </SectionCard>

      <SectionCard title="&ldquo;I already paid another collector&rdquo;" sub="A report to investigate, not a lie to expose.">
        <Script
          bis="Salamat sa pag-ingon nako. Aron ma-ayos dayon ni — naa ka'y resibo? Kinsa man ang nakadawat, kanus-a, ug pila?"
          en="Thank you for telling me. So we can sort it out quickly — do you have the receipt? Who received it, when, and how much?"
        />
        <Script
          bis="Dili nako mag-lalis nimo. I-report nako ni sa opisina karong adlawa ug sila na ang mo-check sa record."
          en="I won't argue with you. I'll report this to the office today and they will check the record."
        />
        <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-ink">
          <li>Photograph the receipt if they have one.</li>
          <li>Check the customer card you brought — if the payment is there, apologise and move on.</li>
          <li>Do not collect on that account today.</li>
          <li>Tell the admin <strong>the same day</strong>.</li>
        </ul>
        <p className="mb-2 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          Never accuse anyone of lying, and never name a colleague as a thief. You do not know what
          happened.
        </p>
        <Log><strong>Refused</strong> — note who, when, how much, and the receipt number.</Log>
      </SectionCard>

      <SectionCard title="They are angry" sub="Your safety is worth more than any collection.">
        <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-ink">
          <li>Lower your voice instead of matching theirs.</li>
          <li>Let them finish — most anger burns out in a minute if it isn&rsquo;t fed.</li>
          <li>Keep your distance and keep the exit behind you. Don&rsquo;t step inside.</li>
          <li>Leave at once if there is a threat, a weapon, alcohol, or a crowd forming.</li>
        </ul>
        <Script
          bis="Sabot ko nga na-init ka. Dili ko ganahan mag-away — trabaho lang ni nako. Sige, mobalik na lang ko sa lain nga adlaw. Salamat sa imong oras."
          en="I understand you're upset. I don't want an argument — this is just my job. I'll come back another day. Thank you for your time."
        />
        <Log><strong>Refused</strong> — note the time you left and whether you were threatened.</Log>
        <p className="text-xs text-muted">
          If you were threatened, tell the owner directly. Leaving is not failing.
        </p>
      </SectionCard>

      <SectionCard title="End of the day" sub="Before 4:30 PM, every working day.">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>Count your cash with the admin. It must equal your <strong>Cash today</strong> total, to the peso.</li>
          <li>Hand over your receipt booklet so the numbers can be checked.</li>
          <li>
            Report any difference <strong>immediately</strong>. A variance reported the same day is a
            mistake; the same variance found later is something much worse.
          </li>
          <li>Liquidate any cash advance — receipts in, unspent balance back.</li>
          <li>Flag anything needing action tomorrow: disputes, threats, promises falling due.</li>
        </ol>
      </SectionCard>
    </div>
  );
}
