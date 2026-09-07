# MFDEX Sales Team Dataset Specification

This dataset contains consolidated monthly mutual fund sales, AUM, and SIP metrics for Sales Relationship Managers and Territory Leads.

Databases included:
- `sales_team_2025.sqlite` (90.7 Million rows)
- `sales_team_2026.sqlite` (55.1 Million rows)

---

## Monetary Unit Standard

All monetary values are expressed in **INR Lakhs (Lacs)** rounded to **4 decimal places**.

- `1.0000` = INR 1,00,000 (1 Lakh)
- `0.2500` = INR 25,000
- `0.0400` = INR 4,000
- `0.0001` = INR 10

---

## Column Specification & Definitions

### 1. Dimension Columns

| Column Name | Data Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | Primary Key record identifier. |
| `amc_master` | TEXT | Asset Management Company / Fund House name. |
| `month` | TEXT | Reporting month period (e.g. `Jan-26`, `Jul-25`). |
| `broker_code` | TEXT | Distributor AMFI Registration Number (ARN Code). |
| `broker_name` | TEXT | Registered legal entity name of the distributor. |
| `broker_type` | TEXT | Channel classification (`MFD` vs `RIA`). |
| `location` | TEXT | City or suburb location name. |
| `t15_b15` | TEXT | City classification tier (`T15` = Top 15 cities, `B15` = Beyond Top 15). |
| `asset_class` | TEXT | SEBI Scheme Category (e.g. `Small Cap Fund`, `Liquid Fund`). |
| `asset_class_group` | TEXT | Broad SEBI group (`Growth/Equity`, `Income/Debt`, `Hybrid Schemes`, `Other Schemes`, `Solution Oriented`). |

### 2. Metric Columns

| Column Name | Unit | Source / Calculation | Description |
| :--- | :--- | :--- | :--- |
| `aum` | INR Lakhs | CAMS `ClgAssets(Amt) A` | Closing AUM balance at month-end. |
| `avg_aum` | INR Lakhs | CAMS `AvgAssets(Amt) A` | Average monthly AUM baseline. |
| `gross_sales` | INR Lakhs | CAMS `Sales(Amt) A` | Fresh purchases and repeat sales during the month. |
| `net_sales` | INR Lakhs | **Calculated** | Real growth: `(gross_sales + switch_in) - (redemptions + switch_out)`. |
| `active_sip_count` | INTEGER | CAMS `TotalSIP(Count) A` | Total count of live active SIP mandates at month-end. |
| `active_sip_book` | INR Lakhs | CAMS `TotalSIP(Amt) A` | Total monthly commitment value of active SIP mandates. |
| `avg_sip_size` | INR Lakhs | **Calculated** | Average ticket size per active SIP: `active_sip_book / active_sip_count`. |
| `new_sip_count` | INTEGER | CAMS `NewSIP(Count) A` | Count of new SIP mandates registered during the month. |
| `new_sip_value` | INR Lakhs | CAMS `NewSIP(Amt) A` | Value of new SIP mandates registered during the month. |

---

## Calculation Rules

1. **Net Sales (INR Lakhs)**
   `net_sales = (gross_sales + switch_in) - (redemptions + switch_out)`
   Net Sales measures actual business inflow after deducting redemptions and net transfers.

2. **Average SIP Size (INR Lakhs)**
   `avg_sip_size = active_sip_book / active_sip_count`
   Calculated only when `active_sip_count > 0`, otherwise set to `0.0000`.

---

## Performance & Indexing

Both SQLite databases contain 4 pre-built single-column indexes for fast queries:

- `idx_[year]_broker_code` (`broker_code`)
- `idx_[year]_location` (`location`)
- `idx_[year]_month` (`month`)
- `idx_[year]_asset_class` (`asset_class`)
