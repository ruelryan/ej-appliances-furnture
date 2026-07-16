// 3-tier customer follow-up messages (Messenger) plus the printed formal
// demand letter. Tier selection comes from v_contract_financials.followup_tier
// — never recomputed here.

import { termLabel } from "./amortization";
import { fmtDate, peso } from "./format";

export const COMPANY = {
  name: "E & J Appliances Furniture",
  shortName: "E & J",
  address: "Purok Gemelina, Bogo, Tomas Oppus, Southern Leyte",
  gcashName: "Ruel Ryan Rosal",
  gcashNumber: "09069029261",
};

// Days the customer is given to settle or make an arrangement after a
// formal demand. Referenced by both the Messenger demand and the letter.
export const DEMAND_DEADLINE_DAYS = 7;

const NUMBER_WORDS: Record<number, string> = {
  3: "three", 5: "five", 7: "seven", 10: "ten",
  14: "fourteen", 15: "fifteen", 30: "thirty",
};
// e.g. "seven (7)" — legal style; falls back to the bare numeral.
const DEADLINE_PHRASE = NUMBER_WORDS[DEMAND_DEADLINE_DAYS]
  ? `${NUMBER_WORDS[DEMAND_DEADLINE_DAYS]} (${DEMAND_DEADLINE_DAYS})`
  : `${DEMAND_DEADLINE_DAYS}`;

const GCASH_BLOCK =
  "To pay via GCash:\n" +
  `   Name: ${COMPANY.gcashName}\n` +
  `   Number: ${COMPANY.gcashNumber}`;

// The repossession clause quoted verbatim from the installment contract.
const CONTRACT_CLAUSE =
  "In the event that the customer fails to make payments for a period of " +
  "three (3) consecutive months following the last received payment, the " +
  "dealer is hereby entitled to demand full payment of the outstanding " +
  "balance. Failure to comply with this demand within a reasonable " +
  "timeframe, as determined by the dealer, shall grant the dealer the right " +
  "to repossess the product without further notice. The customer shall be " +
  "responsible for all costs associated with the repossession, including " +
  "but not limited to, transportation, storage, and any legal fees incurred " +
  "by the dealer.";

export interface ContractFinancials {
  display_name: string;
  item_description: string;
  cash_price: number;
  term_months: number;
  months_elapsed: number;
  total_paid: number;
  expected_to_date: number;
  overdue_amount: number;
  remaining_balance: number;
  last_payment_date: string | null;
  months_since_last_payment: number | null;
  followup_tier: string;
}

export function buildFollowupMessage(c: ContractFinancials): string {
  const name = c.display_name;
  const label = termLabel(c.term_months);

  if (c.followup_tier === "demand") {
    return (
      `Dear ${name},\n\n` +
      `FORMAL NOTICE from ${COMPANY.name}\n\n` +
      `Item: ${c.item_description}\n` +
      `Last payment received: ${fmtDate(c.last_payment_date)}\n` +
      `Outstanding balance: ${peso(c.remaining_balance)}\n\n` +
      `Our records show that no payment has been received on your account for more than three (3) months. Under the terms of your contract, we are now entitled to demand full payment of your outstanding balance.\n\n` +
      `Please settle ${peso(c.remaining_balance)}, or contact us within ${DEADLINE_PHRASE} days of this notice to make a payment arrangement.\n\n` +
      `If we do not hear from you within that period, we will have no choice but to proceed with repossession of the item and, if necessary, legal action, with all related costs charged to your account.\n\n` +
      `We would much rather settle this with you directly — please message us.\n\n` +
      GCASH_BLOCK +
      `\n\n— ${COMPANY.name}`
    );
  }

  if (c.followup_tier === "overdue") {
    return (
      `Hi ${name},\n\n` +
      `Good day from ${COMPANY.name}. This is a friendly reminder about your account.\n\n` +
      `Item: ${c.item_description}\n` +
      `Term: ${label}\n` +
      `Last payment: ${fmtDate(c.last_payment_date)}\n` +
      `Total paid so far: ${peso(c.total_paid)}\n` +
      `Amount past due: ${peso(c.overdue_amount)}\n` +
      `Remaining balance: ${peso(c.remaining_balance)}\n\n` +
      `Your account is currently behind by ${peso(c.overdue_amount)}. Please settle the past-due amount when you can, or message us if you would like to arrange a payment schedule — we are happy to work with you.\n\n` +
      GCASH_BLOCK +
      `\n\nThank you!\n— ${COMPANY.name}`
    );
  }

  return (
    `Hi ${name},\n\n` +
    `Good day from ${COMPANY.name}! Here is a quick update on your account.\n\n` +
    `Item: ${c.item_description}\n` +
    `Term: ${label}\n` +
    `Last payment: ${fmtDate(c.last_payment_date)}\n` +
    `Total paid so far: ${peso(c.total_paid)}\n` +
    `Remaining balance: ${peso(c.remaining_balance)}\n\n` +
    `Your payments are on schedule — thank you! If you have any questions about your account, just message us here.\n\n` +
    GCASH_BLOCK +
    `\n\nThank you!\n— ${COMPANY.name}`
  );
}

// Body of the printed formal demand letter (/print/demand-letter/[id]).
// The page renders the letterhead, date, address, and signature blocks
// around this text.
export function buildDemandLetterBody(
  c: ContractFinancials & { contract_no: string }
): string {
  const months = Math.max(3, Math.floor(c.months_since_last_payment ?? 0));
  const days = DEADLINE_PHRASE;
  return (
    `FORMAL DEMAND FOR PAYMENT\n\n` +
    `Dear ${c.display_name},\n\n` +
    `Re: Installment Contract No. ${c.contract_no} — ${c.item_description}\n\n` +
    `Our records show that your last payment was received on ${fmtDate(c.last_payment_date)}, and that no payment has been made for ${months} consecutive months. As of this date, your outstanding balance is ${peso(c.remaining_balance)} (total paid to date: ${peso(c.total_paid)}).\n\n` +
    `Your contract provides:\n\n` +
    `"${CONTRACT_CLAUSE}"\n\n` +
    `Accordingly, we hereby demand full payment of ${peso(c.remaining_balance)} within ${days} days from receipt of this letter.\n\n` +
    `Should you fail to settle or make an acceptable payment arrangement within that period, we will:\n\n` +
    `1. Repossess the ${c.item_description} without further notice, with all costs of repossession, including transportation, storage, and handling, charged to your account; and\n\n` +
    `2. Pursue all available legal remedies — including recovery of the outstanding balance, damages, and all legal fees and costs — should you obstruct the repossession or otherwise fail to meet your obligations under the contract.\n\n` +
    `We urge you to settle this matter immediately. Payment may be made in person or through our official GCash account (Name: ${COMPANY.gcashName}, Number: ${COMPANY.gcashNumber}). If you wish to discuss a payment arrangement, please contact us within the same ${days} day period.`
  );
}

export const COLLECTION_STATUSES = [
  "Paid",
  "Asked for extension",
  "Collect in-person",
  "Pull-out letter prepared",
  "Pull-out letter sent",
  "Item for pull-out",
] as const;

export const DELIVERY_STATUSES = [
  "Out for Delivery",
  "Delivered",
  "Pending",
] as const;

export const ITEM_TYPES = ["Appliances", "Furniture"] as const;
