// 3-tier customer follow-up messages, ported verbatim in tone and content
// from the Apps Script buildPaymentNote(). Tier selection comes from
// v_contract_financials.followup_tier — never recomputed here.

import { termLabel } from "./amortization";
import { fmtDate, peso } from "./format";

export const COMPANY = {
  name: "E & J Appliances Furniture",
  shortName: "E & J",
  address: "Purok Gemelina, Bogo, Tomas Oppus, Southern Leyte",
  gcashName: "Ruel Ryan Rosal",
  gcashNumber: "09069029261",
};

const GCASH_BLOCK =
  "To send your payment, please use our official GCash account:\n" +
  `   Name: ${COMPANY.gcashName}\n` +
  `   Number: ${COMPANY.gcashNumber}`;

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
      `This is a formal notice from ${COMPANY.shortName} regarding your account.\n\n` +
      `📦 Item: ${c.item_description}\n` +
      `💰 Cash Price: ${peso(c.cash_price)}\n` +
      `📋 Term: ${label}\n` +
      `📅 Last Payment Received: ${fmtDate(c.last_payment_date)}\n` +
      `📅 Months Since Last Payment: ${Math.floor(c.months_since_last_payment ?? 0)} month(s)\n\n` +
      `Total Amount Paid: ${peso(c.total_paid)}\n` +
      `⚠️ Outstanding Balance: ${peso(c.remaining_balance)}\n\n` +
      `Our records show that your last payment was on ${fmtDate(c.last_payment_date)}, and no payment has been received for over three (3) consecutive months.\n\n` +
      `As stated in your contract:\n\n` +
      `"In the event that the customer fails to make payments for a period of three (3) consecutive months following the last received payment, the dealer is hereby entitled to demand full payment of the outstanding balance. Failure to comply with this demand within a reasonable timeframe, as determined by the dealer, shall grant the dealer the right to repossess the product without further notice. The customer shall be responsible for all costs associated with the repossession, including but not limited to, transportation, storage, and any legal fees incurred by the dealer."\n\n` +
      `We hereby demand the full and immediate settlement of your outstanding balance of ${peso(c.remaining_balance)}.\n\n` +
      `Please be advised that failure to comply will leave us no choice but to take the following actions:\n\n` +
      `⚠️ 1. REPOSSESSION — We will exercise our right to repossess the ${c.item_description} without further notice. All costs related to repossession, including transportation, storage, and handling, will be charged to your account.\n\n` +
      `⚖️ 2. LEGAL ACTION — Should you refuse to cooperate, prevent or obstruct the repossession of the item, or fail to meet your obligations under this contract in any manner, we will pursue all available legal remedies against you. This includes filing a formal legal complaint and seeking full recovery of the outstanding balance, damages, and all legal fees and court costs, which will likewise be charged to your account.\n\n` +
      `We strongly urge you to settle this matter immediately to avoid repossession of the item and legal proceedings against you.\n\n` +
      GCASH_BLOCK +
      `\n\n— ${COMPANY.shortName} Team`
    );
  }

  if (c.followup_tier === "overdue") {
    return (
      `Hi ${name}! 😊\n\n` +
      `This is a friendly follow-up regarding your account with ${COMPANY.shortName}.\n\n` +
      `📦 Item: ${c.item_description}\n` +
      `💰 Cash Price: ${peso(c.cash_price)}\n` +
      `📋 Term: ${label}\n` +
      `📅 Months Elapsed: ${c.months_elapsed}\n` +
      `📅 Last Payment: ${fmtDate(c.last_payment_date)}\n\n` +
      `Total Amount Paid: ${peso(c.total_paid)}\n` +
      `Expected Payment by Now: ${peso(c.expected_to_date)}\n` +
      `⚠️ Outstanding Balance Due: ${peso(c.overdue_amount)}\n` +
      `Remaining Contract Balance: ${peso(c.remaining_balance)}\n\n` +
      `It looks like your account has a past-due balance of ${peso(c.overdue_amount)}. We'd love to help you get back on track!\n\n` +
      `Please coordinate with us at your earliest convenience to settle the overdue amount or discuss a payment arrangement. We truly value your business and want to work this out together. 🙏\n\n` +
      GCASH_BLOCK +
      `\n\nThank you!\n— ${COMPANY.shortName} Team`
    );
  }

  return (
    `Hi ${name}! 😊\n\n` +
    `Just a quick check-in on your account with ${COMPANY.shortName}.\n\n` +
    `📦 Item: ${c.item_description}\n` +
    `💰 Cash Price: ${peso(c.cash_price)}\n` +
    `📋 Term: ${label}\n` +
    `📅 Months Elapsed: ${c.months_elapsed}\n` +
    `📅 Last Payment: ${fmtDate(c.last_payment_date)}\n\n` +
    `Total Amount Paid: ${peso(c.total_paid)}\n` +
    `Expected Payment by Now: ${peso(c.expected_to_date)}\n` +
    `✅ Your account is up to date!\n` +
    `Remaining Contract Balance: ${peso(c.remaining_balance)}\n\n` +
    `Great job keeping your payments on time! 🎉 If you have any questions or concerns, feel free to reach out anytime.\n\n` +
    GCASH_BLOCK +
    `\n\nThank you!\n— ${COMPANY.shortName} Team`
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
