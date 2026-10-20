/** A shop with a dozen items for Items › Bulk update items (flows and pictures). Fixed names and codes. */
import { expect, type APIRequestContext } from '@playwright/test';
import { APP, freshShop } from './setup';

export type Who = { email: string; password: string };

/** [name, code, category, sale, purchase, GST %] */
const ITEMS: [string, string, string, string, string, number][] = [
  ['Ceiling fan 1200mm', 'CF12', 'Fans', '1890', '1560', 18],
  ['Table fan 400mm', 'TF40', 'Fans', '1450', '1180', 18],
  ['LED bulb 9W', 'LB9', 'Lighting', '95', '62', 12],
  ['LED batten 20W', 'LB20', 'Lighting', '320', '240', 12],
  ['Wire 1.5 sq mm', 'WR15', 'Wires', '1450', '1200', 0],
  ['Wire 2.5 sq mm', 'WR25', 'Wires', '2350', '1980', 18],
  ['Switch 6A', 'SW6', 'Switches', '28', '18', 18],
  ['Socket 16A', 'SK16', 'Switches', '95', '70', 18],
  ['MCB 16A single pole', 'MCB16', 'Protection', '240', '180', 18],
  ['Insulation tape', 'IT1', '', '15', '9', 18],
  ['Door bell', 'DB1', '', '180', '120', 18],
  ['Solar panel 330W', 'SP330', 'Solar', '11500', '9800', 5],
];

export async function signedApi(request: APIRequestContext, who: Who) {
  const token = (await (await request.post(APP + '/api/auth/login', { data: who })).json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: async <T>(path: string) => (await (await request.get(APP + '/api' + path, { headers })).json()) as T,
    post: async <T>(path: string, data: object) => {
      const r = await request.post(APP + '/api' + path, { headers, data });
      expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
      return (await r.json()) as T;
    },
  };
}

/** A new shop with the items above, added oldest first in the order listed (the list shows newest first). */
export async function bulkShop(request: APIRequestContext): Promise<Who> {
  const who = await freshShop(request);
  const a = await signedApi(request, who);
  for (const [name, code, category, sale, purchase, gstRate] of ITEMS) await a.post('/items', { name, code, category, sale, purchase, gstRate, unit: 'PCS' });
  return who;
}
