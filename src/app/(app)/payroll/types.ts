export type PayslipLine = { label: string; amount: number };

// Row shape of the payslips table (all money fields snapshotted by SQL).
export type Payslip = {
  id: string;
  profile_id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "final";
  dtr_hours: string | number;
  dtr_pay: string | number;
  days_worked: number;
  hourly_rate: string | number;
  extra_income: PayslipLine[];
  extra_deductions: PayslipLine[];
  philhealth_ee: string | number;
  philhealth_er: string | number;
  sss_ee: string | number;
  sss_er: string | number;
  pagibig_ee: string | number;
  pagibig_er: string | number;
  total_income: string | number;
  total_deductions: string | number;
  net_pay: string | number;
  finalized_at: string | null;
  created_at: string;
};
