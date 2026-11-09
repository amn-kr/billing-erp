/**
 * Demo shops for visitors: "Open the demo shop" on the sign-in page signs in to this account.
 * Makes four made-up shops under one login (hardware, medical, clothing, kirana) and fills each
 * through the running API, so every total, stock level and ledger is calculated by the real code:
 * 50 items, 50 parties and 50 sales invoices of about ₹10 lakh per shop, plus purchase bills,
 * payments, expenses, quotations and credit notes. All names, phone numbers and GSTINs are invented.
 *
 *   API_URL=http://localhost:3310 DATABASE_URL=... DEMO_EMAIL=demo@billing-erp.example.com \
 *   DEMO_PASSWORD=... pnpm --filter @billing/api db:seed-demo-shop
 *
 * Run it once on an empty database. Needs the API running (it signs in as the demo user).
 */
import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { BusinessesService } from '../src/modules/businesses/businesses.service';

const API = (process.env.API_URL ?? 'http://localhost:3000') + '/api';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@billing-erp.example.com';
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const TODAY = process.env.DEMO_TODAY ?? new Date().toISOString().slice(0, 10);

/* ── small helpers ─────────────────────────────────────────────── */
let seed = 20261109;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

let token = '';
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  // the server limits requests per minute: wait and try again
  for (let tries = 0; ; tries++) {
    res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 429 || tries >= 20) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.message ?? text}\n${JSON.stringify(body).slice(0, 400)}`);
  return json as T;
}

/* ── the shop's items: name, unit, HSN, GST %, sale price, category, brand, sold-in-bulk factor ─ */
type ItemDef = { name: string; unit: string; hsn: string; gst: number; sale: number; cat: string; brand: string; w: number };
const ITEMS: ItemDef[] = [
  { name: 'Havells FHR 1.5 sq mm wire 90 m', unit: 'COIL', hsn: '8544', gst: 18, sale: 2450, cat: 'Wires & cables', brand: 'Havells', w: 5 },
  { name: 'Havells FHR 2.5 sq mm wire 90 m', unit: 'COIL', hsn: '8544', gst: 18, sale: 3980, cat: 'Wires & cables', brand: 'Havells', w: 5 },
  { name: 'Polycab 4 sq mm wire 90 m', unit: 'COIL', hsn: '8544', gst: 18, sale: 6150, cat: 'Wires & cables', brand: 'Polycab', w: 3 },
  { name: 'Polycab 1.0 sq mm wire 90 m', unit: 'COIL', hsn: '8544', gst: 18, sale: 1620, cat: 'Wires & cables', brand: 'Polycab', w: 4 },
  { name: 'Finolex 3 core flexible cable 1.5 sq mm 100 m', unit: 'COIL', hsn: '8544', gst: 18, sale: 5480, cat: 'Wires & cables', brand: 'Finolex', w: 2 },
  { name: 'Legrand Myrius modular switch 6A', unit: 'PCS', hsn: '8536', gst: 18, sale: 62, cat: 'Switches & MCBs', brand: 'Legrand', w: 40 },
  { name: 'Legrand Myrius socket 6/16A', unit: 'PCS', hsn: '8536', gst: 18, sale: 148, cat: 'Switches & MCBs', brand: 'Legrand', w: 25 },
  { name: 'Anchor Roma switch 6A', unit: 'PCS', hsn: '8536', gst: 18, sale: 38, cat: 'Switches & MCBs', brand: 'Anchor', w: 60 },
  { name: 'Anchor Roma 5-pin socket', unit: 'PCS', hsn: '8536', gst: 18, sale: 92, cat: 'Switches & MCBs', brand: 'Anchor', w: 30 },
  { name: 'Havells MCB 16A single pole', unit: 'PCS', hsn: '8536', gst: 18, sale: 185, cat: 'Switches & MCBs', brand: 'Havells', w: 25 },
  { name: 'Havells MCB 32A double pole', unit: 'PCS', hsn: '8536', gst: 18, sale: 620, cat: 'Switches & MCBs', brand: 'Havells', w: 12 },
  { name: 'Havells RCCB 40A 30 mA', unit: 'PCS', hsn: '8536', gst: 18, sale: 1980, cat: 'Switches & MCBs', brand: 'Havells', w: 5 },
  { name: 'Legrand 8-way MCB distribution box', unit: 'PCS', hsn: '8537', gst: 18, sale: 1750, cat: 'Switches & MCBs', brand: 'Legrand', w: 4 },
  { name: 'Bajaj 9 W LED bulb', unit: 'PCS', hsn: '9405', gst: 12, sale: 68, cat: 'Lighting', brand: 'Bajaj', w: 80 },
  { name: 'Philips 12 W LED bulb', unit: 'PCS', hsn: '9405', gst: 12, sale: 110, cat: 'Lighting', brand: 'Philips', w: 60 },
  { name: 'Philips 22 W LED batten 4 ft', unit: 'PCS', hsn: '9405', gst: 12, sale: 340, cat: 'Lighting', brand: 'Philips', w: 25 },
  { name: 'Crompton 15 W LED panel round', unit: 'PCS', hsn: '9405', gst: 12, sale: 295, cat: 'Lighting', brand: 'Crompton', w: 25 },
  { name: 'Crompton 36 W LED panel 2x2', unit: 'PCS', hsn: '9405', gst: 12, sale: 880, cat: 'Lighting', brand: 'Crompton', w: 12 },
  { name: 'Wipro 50 W LED flood light', unit: 'PCS', hsn: '9405', gst: 12, sale: 760, cat: 'Lighting', brand: 'Wipro', w: 10 },
  { name: 'Syska 20 W LED street light', unit: 'PCS', hsn: '9405', gst: 12, sale: 640, cat: 'Lighting', brand: 'Syska', w: 8 },
  { name: 'Havells Ambrose ceiling fan 1200 mm', unit: 'PCS', hsn: '8414', gst: 18, sale: 2990, cat: 'Fans', brand: 'Havells', w: 6 },
  { name: 'Crompton HS Plus ceiling fan 1200 mm', unit: 'PCS', hsn: '8414', gst: 18, sale: 2150, cat: 'Fans', brand: 'Crompton', w: 6 },
  { name: 'Orient Aeroquiet ceiling fan 1200 mm', unit: 'PCS', hsn: '8414', gst: 18, sale: 2680, cat: 'Fans', brand: 'Orient', w: 5 },
  { name: 'Bajaj Maxima pedestal fan 400 mm', unit: 'PCS', hsn: '8414', gst: 18, sale: 2460, cat: 'Fans', brand: 'Bajaj', w: 3 },
  { name: 'Usha exhaust fan 150 mm', unit: 'PCS', hsn: '8414', gst: 18, sale: 920, cat: 'Fans', brand: 'Usha', w: 8 },
  { name: 'Havells Instanio 3 L water heater', unit: 'PCS', hsn: '8516', gst: 18, sale: 3290, cat: 'Accessories', brand: 'Havells', w: 3 },
  { name: 'Racold 15 L storage geyser', unit: 'PCS', hsn: '8516', gst: 18, sale: 7450, cat: 'Accessories', brand: 'Racold', w: 2 },
  { name: 'Kirloskar 0.5 HP water pump', unit: 'PCS', hsn: '8413', gst: 18, sale: 6850, cat: 'Pipes & fittings', brand: 'Kirloskar', w: 2 },
  { name: 'Crompton 1 HP submersible pump', unit: 'PCS', hsn: '8413', gst: 18, sale: 12400, cat: 'Pipes & fittings', brand: 'Crompton', w: 1 },
  { name: 'Astral CPVC pipe 1 inch 3 m', unit: 'PCS', hsn: '3917', gst: 18, sale: 540, cat: 'Pipes & fittings', brand: 'Astral', w: 15 },
  { name: 'Astral CPVC elbow 1 inch', unit: 'PCS', hsn: '3917', gst: 18, sale: 46, cat: 'Pipes & fittings', brand: 'Astral', w: 60 },
  { name: 'Supreme PVC pipe 2 inch 6 m', unit: 'PCS', hsn: '3917', gst: 18, sale: 980, cat: 'Pipes & fittings', brand: 'Supreme', w: 10 },
  { name: 'Brass ball valve 1 inch', unit: 'PCS', hsn: '8481', gst: 18, sale: 395, cat: 'Pipes & fittings', brand: 'Local', w: 10 },
  { name: 'PTFE thread seal tape', unit: 'PCS', hsn: '3919', gst: 18, sale: 22, cat: 'Pipes & fittings', brand: 'Local', w: 100 },
  { name: 'Asian Paints Tractor Emulsion 20 L white', unit: 'PCS', hsn: '3209', gst: 18, sale: 4750, cat: 'Paints & putty', brand: 'Asian Paints', w: 4 },
  { name: 'Asian Paints Apex exterior 10 L', unit: 'PCS', hsn: '3209', gst: 18, sale: 3420, cat: 'Paints & putty', brand: 'Asian Paints', w: 4 },
  { name: 'Birla White wall putty 40 kg', unit: 'BAG', hsn: '3214', gst: 18, sale: 1180, cat: 'Paints & putty', brand: 'Birla White', w: 12 },
  { name: 'Berger enamel paint 1 L', unit: 'PCS', hsn: '3208', gst: 18, sale: 495, cat: 'Paints & putty', brand: 'Berger', w: 15 },
  { name: 'Paint brush 4 inch', unit: 'PCS', hsn: '9603', gst: 18, sale: 120, cat: 'Paints & putty', brand: 'Local', w: 30 },
  { name: 'Bosch GSB 500 impact drill', unit: 'PCS', hsn: '8467', gst: 18, sale: 3150, cat: 'Hardware', brand: 'Bosch', w: 3 },
  { name: 'Taparia screwdriver set 8 pcs', unit: 'SET', hsn: '8205', gst: 18, sale: 520, cat: 'Hardware', brand: 'Taparia', w: 10 },
  { name: 'Stanley claw hammer 500 g', unit: 'PCS', hsn: '8205', gst: 18, sale: 380, cat: 'Hardware', brand: 'Stanley', w: 8 },
  { name: 'Godrej Navtal 65 mm padlock', unit: 'PCS', hsn: '8301', gst: 18, sale: 340, cat: 'Hardware', brand: 'Godrej', w: 15 },
  { name: 'MS nuts and bolts assorted box', unit: 'BOX', hsn: '7318', gst: 18, sale: 650, cat: 'Hardware', brand: 'Local', w: 10 },
  { name: 'Fevicol SH 1 kg', unit: 'PCS', hsn: '3506', gst: 18, sale: 215, cat: 'Hardware', brand: 'Pidilite', w: 20 },
  { name: 'PVC insulation tape (10 rolls)', unit: 'PACK', hsn: '3919', gst: 18, sale: 180, cat: 'Accessories', brand: 'Local', w: 30 },
  { name: 'Extension board 4 socket 3 m', unit: 'PCS', hsn: '8536', gst: 18, sale: 420, cat: 'Accessories', brand: 'Anchor', w: 15 },
  { name: 'Exide 12 V 7 Ah UPS battery', unit: 'PCS', hsn: '8507', gst: 28, sale: 1650, cat: 'Accessories', brand: 'Exide', w: 6 },
  { name: 'Luminous 900 VA inverter', unit: 'PCS', hsn: '8504', gst: 28, sale: 6890, cat: 'Accessories', brand: 'Luminous', w: 2 },
  { name: 'Delivery and fitting charges', unit: 'NOS', hsn: '9954', gst: 18, sale: 500, cat: 'Services', brand: '', w: 0 },
];

/* ── people (all invented) ─────────────────────────────────────── */
const CUSTOMERS = [
  ['Gupta Electricals', 'Hazratganj', 'Lucknow', '226001', '09'], ['Verma Builders & Contractors', 'Aliganj', 'Lucknow', '226024', '09'],
  ['Singh Hardware Store', 'Chowk', 'Lucknow', '226003', '09'], ['Mishra Constructions', 'Gomti Nagar', 'Lucknow', '226010', '09'],
  ['Shree Ram Interiors', 'Indira Nagar', 'Lucknow', '226016', '09'], ['Ansari Electric Works', 'Aminabad', 'Lucknow', '226018', '09'],
  ['Kapoor Developers', 'Vikas Nagar', 'Lucknow', '226022', '09'], ['Yadav Electrical Services', 'Alambagh', 'Lucknow', '226005', '09'],
  ['Tiwari Bhawan Nirman', 'Kanpur Road', 'Lucknow', '226012', '09'], ['Sunrise Apartments Society', 'Jankipuram', 'Lucknow', '226021', '09'],
  ['Khan Plumbing & Sanitary', 'Daliganj', 'Lucknow', '226020', '09'], ['Pandey Brothers Contractors', 'Rajajipuram', 'Lucknow', '226017', '09'],
  ['City Hospital Maintenance', 'Mahanagar', 'Lucknow', '226006', '09'], ['Agarwal Paints & Hardware', 'Naka Hindola', 'Lucknow', '226018', '09'],
  ['Saxena Lighting House', 'Sitapur Road', 'Lucknow', '226020', '09'], ['Jain Traders', 'Charbagh', 'Lucknow', '226004', '09'],
  ['Modern Public School', 'Kursi Road', 'Lucknow', '226026', '09'], ['Dubey Electrical Contractors', 'Faizabad Road', 'Lucknow', '226028', '09'],
  ['Rastogi Engineering Works', 'Amausi', 'Lucknow', '226009', '09'], ['Patel Home Solutions', 'Telibagh', 'Lucknow', '226025', '09'],
  ['Chauhan Electrical Mart', 'Barabanki', 'Barabanki', '225001', '09'], ['Awasthi Constructions', 'Unnao', 'Unnao', '209801', '09'],
  ['Maurya Tubewell Works', 'Sitapur', 'Sitapur', '261001', '09'], ['Bajpai Wiring Contractors', 'Raebareli', 'Raebareli', '229001', '09'],
  ['Goel Cement & Hardware', 'Hardoi', 'Hardoi', '241001', '09'], ['Hotel Awadh Residency', 'Gomti Nagar', 'Lucknow', '226010', '09'],
  ['Sharma Farm House', 'Mohanlalganj', 'Lucknow', '226301', '09'], ['Bhatia Furnishing', 'Aliganj', 'Lucknow', '226024', '09'],
  ['Rawat Electricals', 'Dehradun', 'Dehradun', '248001', '05'], ['Malhotra Projects', 'Karol Bagh', 'New Delhi', '110005', '07'],
  ['Srivastava Cold Storage', 'Chinhat', 'Lucknow', '226028', '09'], ['Nigam Villa Works', 'Mahanagar', 'Lucknow', '226006', '09'],
  ['Kushwaha Electric Point', 'Gonda', 'Gonda', '271001', '09'], ['Ojha Plumbing Works', 'Faizabad', 'Ayodhya', '224001', '09'],
  ['Trivedi Interiors', 'Kapoorthala', 'Lucknow', '226024', '09'], ['Lucknow Fitness Club', 'Gomti Nagar', 'Lucknow', '226010', '09'],
  ['Joshi Power Solutions', 'Haldwani', 'Haldwani', '263139', '05'], ['Siddiqui Workshop', 'Kakori', 'Lucknow', '226101', '09'],
] as const;
const SUPPLIERS = [
  ['Havells India Distributor – Kanpur', 'Swaroop Nagar', 'Kanpur', '208002', '09'], ['Polycab Wires Agency', 'Naya Ganj', 'Kanpur', '208001', '09'],
  ['Legrand & Anchor Wholesale', 'Chandni Chowk', 'New Delhi', '110006', '07'], ['Crompton Greaves Stockist', 'Hazratganj', 'Lucknow', '226001', '09'],
  ['Philips Lighting Distributors', 'Aminabad', 'Lucknow', '226018', '09'], ['Astral Pipes Dealer', 'Transport Nagar', 'Lucknow', '226012', '09'],
  ['Asian Paints Depot', 'Faizabad Road', 'Lucknow', '226028', '09'], ['Bosch & Stanley Tools Traders', 'Lohamandi', 'Agra', '282002', '09'],
  ['Kirloskar Pumps Agency', 'Industrial Area', 'Kanpur', '208022', '09'], ['Racold Geysers Stockist', 'Alambagh', 'Lucknow', '226005', '09'],
  ['Luminous Power Distributors', 'Sadar Bazar', 'Delhi', '110006', '07'], ['General Hardware Wholesalers', 'Sitapur Road', 'Lucknow', '226020', '09'],
] as const;
const FIRST = ['Rahul', 'Amit', 'Sunil', 'Vikas', 'Deepak', 'Manoj', 'Pankaj', 'Ritesh', 'Anil', 'Sandeep', 'Mohit', 'Ajay'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Yadav', 'Mishra', 'Khan', 'Pandey'];
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const gstin = (st: string) => st + Array.from({ length: 5 }, () => A[between(0, A.length - 1)]).join('') + String(between(1000, 9999)) + A[between(0, A.length - 1)] + '1Z' + String(between(1, 9));
const phone = () => String(between(6, 9)) + String(between(100000000, 999999999));

/* ── the other three shops: items are written as "stem|unit|HSN|GST|category|brand|usual qty|label:price,…" ── */
const expand = (rows: string[]): ItemDef[] =>
  rows.flatMap((r) => {
    const [stem, unit, hsn, gst, cat, brand, w, vars] = r.split('|') as [string, string, string, string, string, string, string, string];
    return vars.split(',').map((v) => {
      const [label, price] = v.split(':') as [string, string];
      return { name: `${stem} ${label}`.trim(), unit, hsn, gst: Number(gst), sale: Number(price), cat, brand, w: Number(w) };
    });
  });

const MEDICAL_ITEMS = expand([
  'Paracetamol|STRIP|3004|5|Tablets|Cipla|40|500 mg 15 tabs:32,650 mg 15 tabs:42,Dolo 650 15 tabs:34',
  'Azithromycin|STRIP|3004|5|Tablets|Cipla|12|250 mg 6 tabs:92,500 mg 3 tabs:118,500 mg 5 tabs:178',
  'Cetirizine|STRIP|3004|5|Tablets|Sun Pharma|35|10 mg 10 tabs:28,5 mg syrup 60 ml:58,Levocetirizine 5 mg 10 tabs:46',
  'Pantoprazole|STRIP|3004|5|Tablets|Alkem|30|40 mg 10 tabs:96,40 mg + Domperidone 10 caps:132,20 mg 10 tabs:72',
  'Amoxicillin + Clavulanate|STRIP|3004|5|Tablets|Mankind|15|625 mg 6 tabs:198,375 mg 10 tabs:176,Dry syrup 30 ml:112',
  'Metformin|STRIP|3004|5|Tablets|USV|30|500 mg 20 tabs:28,850 mg 15 tabs:34,1000 mg SR 10 tabs:52',
  'Amlodipine|STRIP|3004|5|Tablets|Torrent|30|5 mg 15 tabs:44,10 mg 15 tabs:72,Telmisartan 40 mg 15 tabs:112',
  'Atorvastatin|STRIP|3004|5|Tablets|Zydus|20|10 mg 15 tabs:138,20 mg 15 tabs:196,40 mg 15 tabs:286',
  'Cough syrup|BTL|3004|5|Syrups|Dabur|18|Honitus 100 ml:92,Benadryl 100 ml:118,Ascoril LS 100 ml:132',
  'ORS powder|PCS|3004|5|Syrups|Electral|40|Electral 21.8 g:22,Electral orange 21.8 g:24,Pedialyte 200 ml:78',
  'Vitamin and mineral|STRIP|2106|18|Supplements|Abbott|20|Limcee C 15 tabs:40,Shelcal 500 15 tabs:118,Becosules 20 caps:52',
  'Pain relief gel/spray|PCS|3004|12|Topical|Novartis|15|Voveran gel 30 g:92,Volini gel 50 g:138,Moov spray 80 g:172',
  'Antiseptic|PCS|3004|12|Topical|Win-Medicare|20|Betadine 5% 15 g:86,Dettol 250 ml:104,Savlon 200 ml:92',
  'Digital thermometer|PCS|9025|12|Devices|Dr Morepen|8|MT-101:165,MT-111 flexible:225,Infrared forehead:1450',
  'BP monitor|PCS|9018|12|Devices|Omron|4|HEM-7120:1850,HEM-7121J:2250,Dr Morepen BP-02:1320',
  'Glucometer|PCS|9027|12|Devices|Accu-Chek|6|Active meter:1050,Active strips 50:790,Lancets 100:240',
  'Surgical mask and gloves|BOX|6307|5|Disposables|Generic|12|3-ply mask box of 50:140,N95 mask each:48,Latex gloves box of 100:420',
  'Sanitary and baby care|PACK|9619|12|Baby care|Pampers|10|Pampers M 58 pcs:1090,Whisper Ultra 30 pcs:295,Dettol hand wash 900 ml:185',
]);

const CLOTHING_ITEMS = expand([
  "Men's cotton shirt|PCS|6205|5|Menswear|Raymond|20|M:540,L:560,XL:590",
  "Men's jeans|PCS|6203|5|Menswear|Levi's|14|30 in:1290,32 in:1290,34 in:1340",
  "Men's round-neck T-shirt|PCS|6109|5|Menswear|Jockey|28|M:340,L:340,XL:365",
  "Men's formal trouser|PCS|6203|5|Menswear|Peter England|12|32 in:820,34 in:820,36 in:860",
  "Men's kurta|PCS|6205|5|Menswear|Fabindia|12|M:760,L:780,XL:820",
  "Men's jacket|PCS|6201|18|Menswear|Allen Solly|6|M:2450,L:2490,XL:2590",
  "Women's kurti|PCS|6204|5|Womenswear|Biba|20|M:650,L:680,XL:720",
  "Women's saree|PCS|5407|5|Womenswear|Local|10|Cotton:780,Georgette:1450,Silk blend:2650",
  "Salwar suit set|SET|6204|5|Womenswear|Aurelia|9|Cotton:1150,Chanderi:1890,Georgette:2250",
  "Leggings|PCS|6104|5|Womenswear|Go Colors|30|Free size:340,Churidar:365,Ankle length:320",
  "Dupatta|PCS|6214|5|Womenswear|Local|20|Chiffon:210,Cotton:240,Phulkari:560",
  "Kids frock|PCS|6104|5|Kidswear|Biba|14|2-4 yrs:390,5-7 yrs:460,8-10 yrs:530",
  "Kids T-shirt|PCS|6109|5|Kidswear|Jockey|24|2-4 yrs:210,5-7 yrs:240,8-10 yrs:270",
  "Track pant|PCS|6103|5|Sportswear|Puma|14|M:790,L:810,XL:850",
  "Innerwear pack|PACK|6107|5|Innerwear|Lux Cozi|30|Briefs pack of 3:290,Vests pack of 3:340,Bra pack of 2:420",
  "Socks pack|PACK|6115|5|Innerwear|Jockey|30|Ankle pack of 3:240,Crew pack of 3:290,Sports pack of 3:340",
  "Bedsheet set|SET|6302|5|Home linen|Bombay Dyeing|10|Single:690,Double:1090,King:1490",
  "Bath towel|PCS|6302|5|Home linen|Spaces|20|Small:210,Medium:340,Large:520",
]);

const KIRANA_ITEMS = expand([
  'Atta|BAG|1101|0|Staples|Aashirvaad|20|5 kg:268,10 kg:515,Chakki fresh 10 kg:480',
  'Rice|BAG|1006|0|Staples|India Gate|14|Basmati classic 5 kg:640,Basmati Dubar 5 kg:520,Sona masoori 10 kg:610',
  'Sugar and salt|KG|1701|5|Staples|Tata|60|Sugar 1 kg:46,Tata salt 1 kg:28,Jaggery 1 kg:62',
  'Dal|KG|0713|0|Staples|Tata Sampann|30|Toor dal 1 kg:158,Moong dal 1 kg:122,Chana dal 1 kg:96',
  'Edible oil|LTR|1512|5|Oils and ghee|Fortune|28|Sunflower 1 L:138,Mustard 1 L:152,Soyabean 1 L:122',
  'Ghee|PCS|0405|12|Oils and ghee|Amul|10|500 ml:340,1 L:655,Cow ghee 200 ml:152',
  'Noodles and pasta|PACK|1902|12|Packaged food|Maggi|35|Maggi 12 pack:168,Yippee 6 pack:90,Pasta 500 g:78',
  'Biscuits|CTN|1905|18|Packaged food|Parle|18|Parle-G carton 24:288,Good Day carton 24:360,Marie Gold carton 24:312',
  'Tea and coffee|PCS|0902|5|Beverages|Tata Tea|25|Gold 500 g:285,Premium 1 kg:540,Nescafe Classic 100 g:310',
  'Cold drinks and water|CASE|2202|28|Beverages|Pepsi|12|Pepsi 2 L case of 6:660,Maaza 600 ml case of 12:540,Bisleri 1 L case of 12:240',
  'Detergent|PCS|3402|18|Home care|Surf Excel|20|Easy wash 1 kg:128,Matic 2 kg:520,Vim bar pack of 4:80',
  'Soap|PACK|3401|18|Personal care|Lifebuoy|30|Lifebuoy pack of 4:140,Lux pack of 4:172,Dettol pack of 3:150',
  'Toothpaste and brush|PCS|3306|18|Personal care|Colgate|40|Strong Teeth 200 g:112,Dant Kanti 200 g:98,Brush pack of 4:140',
  'Shampoo and hair oil|PCS|3305|18|Personal care|Dabur|25|Amla oil 500 ml:230,Clinic Plus 650 ml:360,Parachute 500 ml:215',
  'Masala|PACK|0910|5|Spices|MDH|30|Turmeric 200 g:78,Red chilli 200 g:112,Garam masala 100 g:88',
  'Namkeen and snacks|PACK|2106|12|Packaged food|Haldiram|30|Bhujia 400 g:118,Aloo bhujia 1 kg:285,Moong dal 400 g:112',
  'Butter and cheese|PCS|0405|12|Dairy|Amul|20|Butter 500 g:285,Cheese slices 200 g:130,Paneer 200 g:92',
  'Pooja and household|PACK|3307|18|Home care|Cycle|25|Agarbatti pack of 6:96,Camphor 100 g:88,Matchbox pack of 10:20',
]);

/* ── the four shops ───────────────────────────────────────────── */
type Shop = {
  key: string; name: string; owner: string; addr: string; pin: string; withGst: boolean; items: ItemDef[];
  customers: readonly (readonly [string, string, string, string, string])[]; suppliers: readonly (readonly [string, string, string, string, string])[];
  billNote: string;
};
const AREAS = [['Aliganj', '226024'], ['Gomti Nagar', '226010'], ['Indira Nagar', '226016'], ['Hazratganj', '226001'], ['Alambagh', '226005'], ['Chowk', '226003'], ['Mahanagar', '226006'], ['Jankipuram', '226021'], ['Vikas Nagar', '226022'], ['Rajajipuram', '226017']] as const;
const people = (n: number, extras: string[]) => {
  const out: [string, string, string, string, string][] = extras.map((e) => { const a = pick(AREAS); return [e, a[0], 'Lucknow', a[1], '09']; });
  const used = new Set<string>();
  while (out.length < n) {
    const nm = `${pick(FIRST)} ${pick(LAST)}`;
    if (used.has(nm)) continue;
    used.add(nm);
    const a = pick(AREAS);
    out.push([nm, a[0], 'Lucknow', a[1], '09']);
  }
  return out;
};
const sup = (names: string[]): [string, string, string, string, string][] => names.map((n) => { const a = pick(AREAS); return [n, a[0], 'Lucknow', a[1], '09']; });

const SHOPS: Shop[] = [
  { key: 'hardware', name: 'Sharma Electricals & Hardware', owner: 'Rajesh Sharma', addr: 'Shop 12, Naka Hindola', pin: '226018', withGst: true, items: ITEMS, customers: CUSTOMERS, suppliers: SUPPLIERS, billNote: '' },
  { key: 'medical', name: 'Sanjeevani Medical Store', owner: 'Dr. Anil Mehra', addr: '14, Near District Hospital, Hazratganj', pin: '226001', withGst: true, items: MEDICAL_ITEMS, billNote: '',
    customers: people(38, ['Dr. Kapoor Clinic', 'Lifeline Nursing Home', 'City Care Hospital', 'Shanti Dental Clinic', 'Aarogya Diagnostics', 'Sunrise Old Age Home', 'Dr. Rizvi Child Clinic', 'Navjeevan Health Centre']),
    suppliers: sup(['Cipla Distributors – Lucknow', 'Sun Pharma Stockist', 'Mankind Pharma Agency', 'Alkem Laboratories Dealer', 'Zydus Healthcare Depot', 'Torrent Pharma Stockist', 'Abbott India Distributor', 'Omron Healthcare Dealer', 'Dabur & Himalaya Wholesale', 'Medico Surgicals Traders', 'Pampers & Baby Care Agency', 'Generic Disposables Supply']) },
  { key: 'clothing', name: 'Royal Fashion Point', owner: 'Neha Agarwal', addr: '27, Main Market, Aminabad', pin: '226018', withGst: true, items: CLOTHING_ITEMS, billNote: '',
    customers: people(38, ['Shree Boutique', 'Anjali Fashion Store', 'Mehta Wedding Collection', 'Modern School Uniforms', 'Gupta Garments Retail', 'Priya Ladies Corner', 'Royal Hotel Staff Uniforms', 'Kidz Zone']),
    suppliers: sup(['Raymond Distributor – Kanpur', "Levi's & Jockey Agency", 'Peter England Stockist', 'Biba & Aurelia Wholesale', 'Surat Sarees Traders', 'Fabindia Dealer', 'Bombay Dyeing Linen Agency', 'Go Colors Wholesale', 'Lux Cozi Distributor', 'Puma Sportswear Dealer', 'Chikan Embroidery Works', 'Delhi Garment Hub']) },
  { key: 'kirana', name: 'Gupta Kirana & General Store', owner: 'Mahesh Gupta', addr: '8, Subhash Market, Chowk', pin: '226003', withGst: false, items: KIRANA_ITEMS, billNote: '',
    customers: people(38, ['Hotel Awadh Palace', 'Shiv Sweets & Caterers', 'Balaji Tiffin Service', 'Sai Restaurant', 'Mohan Tea Stall', 'Anand Bhojnalaya', 'Sunrise Hostel Mess', 'Ganesh Canteen']),
    suppliers: sup(['Aashirvaad ITC Distributor', 'Fortune Oils Stockist', 'Tata Consumer Agency', 'Parle & Britannia Wholesale', 'Amul Dairy Dealer', 'HUL Distributor – Lucknow', 'Colgate Palmolive Agency', 'Haldiram Snacks Dealer', 'Maggi Nestle Stockist', 'Pepsi Bottling Agency', 'MDH Spices Wholesale', 'Chowk Grain Merchants']) },
];

const SHOP_SALES_TOTAL = Number(process.env.DEMO_SHOP_TOTAL ?? 1_000_000);
const PAY_MODES_DEMO = ['Cash', 'UPI', 'Bank transfer'] as const;

/* what a bill comes to: the same rounding as the API (each line, then the bill rounded to the rupee) */
const billTotal = (lines: { qty: number; price: number; disc: number; gst: number }[]) =>
  Math.round(lines.reduce((s, l) => s + l.qty * l.price * (1 - l.disc / 100) * (1 + l.gst / 100), 0));

async function fillShop(shop: Shop, businessId: string) {
  const log = (m: string) => console.log(`  [${shop.key}] ${m}`);
  const sw = await call<{ accessToken: string }>('POST', '/businesses/switch', { businessId });
  token = sw.accessToken;

  await call('POST', '/banking/accounts', { name: 'HDFC Bank – Current A/c', sub: 'Current account', accountNo: String(between(10000000000000, 99999999999999)), ifsc: 'HDFC0000123', branch: 'Lucknow', openingBalance: '600000', openingDate: addDays(TODAY, -215), isDefault: true });

  /* parties */
  const parties: { id: string; kind: 'customer' | 'supplier'; state: string }[] = [];
  const mk = async (kind: 'customer' | 'supplier', d: readonly [string, string, string, string, string], i: number) => {
    const registered = kind === 'supplier' || (shop.withGst && i % 3 !== 0);
    const p = await call('POST', '/parties', {
      name: d[0], kind, group: kind === 'supplier' ? 'Suppliers' : pick(['Wholesale customers', 'Retail customers', 'Contractors']),
      phone: phone(), email: kind === 'supplier' ? '' : `accounts${i}@example.com`, gstin: registered ? gstin(d[4]) : '', gstType: registered ? 'Registered' : 'Unregistered',
      state: d[4], billing: { line: d[1], city: d[2], pin: d[3], state: d[4] }, creditLimit: kind === 'customer' ? String(between(2, 8) * 50000) : '0', creditDays: kind === 'customer' ? pick([15, 30, 45]) : 0,
    });
    parties.push({ id: p.id, kind, state: d[4] });
  };
  for (const [i, d] of shop.customers.entries()) await mk('customer', d, i);
  for (const [i, d] of shop.suppliers.entries()) await mk('supplier', d, i);

  /* items: stock comes in through the purchase bills below */
  const defs = shop.items.slice(0, 50);
  const items: { id: string; def: ItemDef; purchase: number; sold: number }[] = [];
  for (const [i, d] of defs.entries()) {
    const purchase = r2(d.sale * (0.74 + rnd() * 0.12));
    const it = await call('POST', '/items', {
      name: d.name, kind: d.cat === 'Services' ? 'service' : 'goods', code: `${shop.key.slice(0, 2).toUpperCase()}${String(i + 1).padStart(3, '0')}`, hsn: d.hsn, unit: d.unit, category: d.cat, brand: d.brand,
      gstRate: d.gst, sale: String(d.sale), purchase: String(purchase), mrp: String(Math.round(d.sale * 1.1)), minStock: d.w ? String(Math.max(2, Math.round(d.w / 3))) : '0',
    });
    items.push({ id: it.id, def: d, purchase, sold: 0 });
  }
  const goods = items.filter((i) => i.def.w > 0);
  const service = items.find((i) => i.def.w === 0);
  log(`${parties.length} parties, ${items.length} items`);

  /* plan the 50 invoices first, so the purchases bring in enough stock */
  const customers = parties.filter((p) => p.kind === 'customer');
  const suppliers = parties.filter((p) => p.kind === 'supplier');
  const firstSale = addDays(TODAY, -150);
  const dates = Array.from({ length: 50 }, () => addDays(firstSale, between(0, 149))).sort();
  type Plan = { date: string; party: (typeof parties)[number] | null; cashName: string; mode: 'credit' | 'cash'; lines: { item: (typeof items)[number]; qty: number; disc: number }[] };
  const plans: Plan[] = dates.map((date, n) => {
    const cash = n % 4 === 3;
    const chosen = new Set<(typeof goods)[number]>();
    const want = between(2, 6);
    while (chosen.size < want) chosen.add(pick(goods));
    return {
      date, mode: cash ? 'cash' : 'credit', party: cash ? null : pick(customers), cashName: cash ? `${pick(FIRST)} ${pick(LAST)}` : '',
      lines: [...chosen].map((item) => ({ item, qty: Math.max(1, Math.round(item.def.w * (0.4 + rnd() * 1.6))), disc: pick([0, 0, 0, 2, 3, 5]) })),
    };
  });
  const sum = () => plans.reduce((s, p) => s + billTotal(p.lines.map((l) => ({ qty: l.qty, price: l.item.def.sale, disc: l.disc, gst: l.item.def.gst }))), 0);
  for (let pass = 0; pass < 8; pass++) {
    const k = SHOP_SALES_TOTAL / sum();
    if (Math.abs(k - 1) < 0.005) break;
    for (const p of plans) for (const l of p.lines) l.qty = Math.max(1, Math.round(l.qty * k));
  }
  for (const p of plans) for (const l of p.lines) l.item.sold += l.qty;

  /* purchase bills: a big first order and a top-up, per supplier */
  const bySupplier = new Map<string, typeof items>();
  goods.forEach((it, i) => { const id = suppliers[i % suppliers.length]!.id; bySupplier.set(id, [...(bySupplier.get(id) ?? []), it]); });
  const billPlans: { sup: string; date: string; lines: { it: (typeof items)[number]; qty: number; rate: number }[] }[] = [];
  // each bill buys at its own rate (a little up or down), so an item's stock shows several purchase rates
  const rateOf = (it: (typeof items)[number]) => r2(it.purchase * (0.93 + rnd() * 0.16));
  for (const [id, its] of bySupplier) {
    const want = its.map((it) => ({ it, total: Math.max(1, Math.ceil(it.sold * (1.03 + rnd() * 0.27))) }));
    const first = want.map((w) => ({ it: w.it, qty: Math.max(1, Math.ceil(w.total * 0.8)), rate: rateOf(w.it) }));
    const top = want.map((w) => ({ it: w.it, qty: w.total - Math.max(1, Math.ceil(w.total * 0.8)), rate: rateOf(w.it) })).filter((l) => l.qty > 0);
    const half = Math.ceil(first.length / 2);
    billPlans.push({ sup: id, date: addDays(firstSale, -between(60, 80)), lines: first.slice(0, half) });
    if (first.length > half) billPlans.push({ sup: id, date: addDays(firstSale, -between(25, 55)), lines: first.slice(half) });
    // one more small bill of every item, bought recently at yet another rate
    billPlans.push({ sup: id, date: addDays(TODAY, -between(4, 30)), lines: its.map((it) => ({ it, qty: Math.max(2, Math.round(it.def.w * 0.4)), rate: rateOf(it) })) });
    if (top.length) billPlans.push({ sup: id, date: addDays(firstSale, between(45, 70)), lines: top });
  }
  billPlans.sort((a, b) => a.date.localeCompare(b.date));
  const bills: { id: string; sup: string; date: string; total: number }[] = [];
  for (const b of billPlans) {
    const total = billTotal(b.lines.map((l) => ({ qty: l.qty, price: l.rate, disc: 0, gst: l.it.def.gst })));
    const r = await call('POST', '/purchases', {
      kind: 'bill', supplierRef: `INV/${between(1000, 9999)}`, date: b.date, dueDate: addDays(b.date, 30), partyId: b.sup, pricesInclTax: false, updatePrices: false,
      lines: b.lines.map((l) => ({ itemId: l.it.id, name: l.it.def.name, hsn: l.it.def.hsn, unit: l.it.def.unit, qty: String(l.qty), rate: String(l.rate), discPct: '0', gstRate: String(l.it.def.gst) })),
    });
    bills.push({ id: r.id, sup: b.sup, date: b.date, total });
  }
  log(`${bills.length} purchase bills`);

  /* the 50 sales invoices, in date order (counter sales are paid in full at once) */
  const sales: { id: string; party: string | null; date: string; total: number; plan: Plan }[] = [];
  for (const p of plans) {
    const lines = p.lines.map((l) => ({ itemId: l.item.id, name: l.item.def.name, hsn: l.item.def.hsn, unit: l.item.def.unit, qty: String(l.qty), price: String(l.item.def.sale), discPct: String(l.disc), gstRate: String(l.item.def.gst) }));
    const calc = p.lines.map((l) => ({ qty: l.qty, price: l.item.def.sale, disc: l.disc, gst: l.item.def.gst }));
    if (service && rnd() < 0.15) { lines.push({ itemId: service.id, name: service.def.name, hsn: service.def.hsn, unit: service.def.unit, qty: '1', price: '500', discPct: '0', gstRate: '18' }); calc.push({ qty: 1, price: 500, disc: 0, gst: 18 }); }
    const total = billTotal(calc);
    const mode = pick(PAY_MODES_DEMO);
    const r = await call('POST', '/sales', {
      kind: 'invoice', date: p.date, dueDate: addDays(p.date, 30), mode: p.mode, partyId: p.party?.id ?? null, cashName: p.cashName, pricesInclTax: false,
      placeOfSupply: p.party?.state ?? '09', confirmOverLimit: true, lines, payments: p.mode === 'cash' ? [{ mode, amount: String(total) }] : [],
    });
    sales.push({ id: r.id, party: p.party?.id ?? null, date: p.date, total, plan: p });
  }
  log(`${sales.length} sales invoices`);

  /* customers pay most credit bills, some in part; the newest stay due */
  let receipts = 0;
  for (const s of sales) {
    if (!s.party || rnd() < 0.2) continue;
    const date = addDays(s.date, between(4, 40));
    if (date > TODAY) continue;
    const amount = rnd() < 0.3 ? Math.round(s.total * pick([0.4, 0.5, 0.7])) : s.total;
    await call('POST', '/receipts', { partyId: s.party, date, amount: String(amount), mode: pick(PAY_MODES_DEMO), accountId: null, allocations: [{ to: s.id, amount: String(amount) }] });
    receipts++;
  }
  /* we pay suppliers: older bills in full, the newest left open */
  let paidOut = 0;
  for (const b of bills) {
    const date = addDays(b.date, between(7, 30));
    if (date > addDays(TODAY, -10) || rnd() < 0.1) continue;
    await call('POST', '/payments-made', { partyId: b.sup, date, amount: String(b.total), mode: 'Bank transfer', accountId: null, allocations: [{ to: b.id, amount: String(b.total) }] });
    paidOut++;
  }
  log(`${receipts} payments received, ${paidOut} payments made`);

  /* monthly expenses */
  const cats = await call<{ id: string; name: string }[]>('GET', '/expense-categories');
  const cat = (re: RegExp) => (cats.find((c) => re.test(c.name)) ?? cats[0]!).id;
  let expenses = 0;
  for (let m = 5; m >= 1; m--) {
    const date = addDays(TODAY, -m * 30);
    for (const [re, payee, amt, mode] of [[/rent/i, 'Landlord – shop rent', 18000, 'Bank transfer'], [/electric|power|utilit/i, 'UPPCL electricity bill', between(2400, 4200), 'UPI'], [/salary|wage|staff/i, 'Staff salaries', 32000, 'Bank transfer']] as const) {
      await call('POST', '/expenses', { categoryId: cat(re), date, payee, mode, accountId: null, lines: [{ name: payee, qty: '1', rate: String(amt), gst: '0', amt: String(amt) }] });
      expenses++;
    }
  }
  log(`${expenses} expenses`);

  /* three quotations still open, and two credit notes (goods brought back) */
  for (let q = 0; q < 3; q++) {
    const its = [pick(goods), pick(goods), pick(goods)];
    await call('POST', '/sales', {
      kind: 'quotation', date: addDays(TODAY, -between(1, 12)), partyId: pick(customers).id, pricesInclTax: false,
      lines: its.map((i) => ({ itemId: i.id, name: i.def.name, hsn: i.def.hsn, unit: i.def.unit, qty: String(Math.max(2, i.def.w)), price: String(i.def.sale), discPct: '0', gstRate: String(i.def.gst) })),
    });
  }
  for (const s of sales.filter((x) => x.party).slice(5, 7)) {
    const l = s.plan.lines[0]!;
    await call('POST', '/credit-notes', { partyId: s.party, date: addDays(s.date, 6) > TODAY ? TODAY : addDays(s.date, 6), reason: 'Damaged goods', settle: 'adjust', lines: [{ invoiceId: s.id, itemId: l.item.id, qty: '1', price: String(l.item.def.sale), gstRate: String(l.item.def.gst) }] });
  }

  const list = await call<{ total: string; status?: string }[]>('GET', '/sales?kind=invoice');
  const live = list.filter((x) => x.status !== 'cancelled');
  log(`sales total ₹${live.reduce((s, x) => s + Number(x.total), 0).toLocaleString('en-IN')} on ${live.length} invoices`);
}

async function main() {
  if (PASSWORD.length < 8) throw new Error('Set DEMO_PASSWORD (at least 8 characters).');
  const db = new DbService();
  if (await db.user.findUnique({ where: { email: EMAIL } })) throw new Error(`${EMAIL} already exists. This script fills an empty database once.`);
  const user = await db.user.create({ data: { email: EMAIL, name: 'Demo Owner', phone: '+91 98300 12345', passwordHash: await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) } });
  const svc = new BusinessesService(db, new AuditService());
  const ids: string[] = [];
  for (const s of SHOPS) {
    const b = await svc.create(
      { userId: user.id, email: user.email, ip: '' },
      { name: s.name, owner: s.owner, phone: '+91 98300 12345', addr: s.addr, city: 'Lucknow', pin: s.pin, state: '09', gstin: s.withGst ? gstin('09') : '', inv: '1' },
      { today: addDays(TODAY, -215), trialDays: 36500 },
    );
    ids.push(b.id);
  }
  await db.$disconnect();

  token = (await call<{ accessToken: string }>('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).accessToken;
  for (const [i, s] of SHOPS.entries()) {
    console.log(`${s.name}`);
    await fillShop(s, ids[i]!);
  }
  await call('POST', '/businesses/switch', { businessId: ids[0] });
  console.log(`Done. Sign in as ${EMAIL}, or use "Open the demo shop".`);
  void daysBetween;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
