// Sample notes for the browser tests.
const fm = (title, created, tags) => `---\ntitle: "${title}"\ncreated: ${created}\nupdated: ${created}\n${tags ? `tags: ${JSON.stringify(tags).replace(/,/g, ', ')}\n` : ''}---\n\n`;

export const SEED = {
  'README.md': '# Notes\n',
  'CLAUDE.md': 'Instructions\n',
  '.commitbook/tags.json': JSON.stringify({ tags: [{ name: 'House', color: '#2e7d5b' }, { name: 'Car', color: '#b4541a' }, { name: 'Gifts', color: '#a13a6b' }] }, null, 2) + '\n',
  'welcome.md': fm('Welcome to Commitbook', '2026-09-01T09:00:00Z') + 'This is your notebook.\n',
  'gift-ideas.md': fm('Gift ideas', '2026-09-12T10:00:00Z', ['Gifts']) +
    '## Mum\n\n- Garden kneeler and gloves\n- National Trust membership\n\n## Sam\n\n- Lego Technic set\n- Climbing wall voucher\n\n- [ ] Ask about sizes\n',
  'House/kitchen-renovation.md': fm('Kitchen renovation', '2026-09-20T18:30:00Z', ['House']) +
    'Budget for the spring refit.\n\n## Costs so far\n\n' +
    '<!-- commitbook:sheet {"totals":2,"formats":{"3":"gbp"}} -->\n' +
    '| Item | Supplier | Status | Cost (£) |\n| --- | --- | --- | --- |\n' +
    '| Oak worktop | Howdens | Ordered | 640 |\n| Splashback tiles | Topps Tiles | Quoted | 222 |\n' +
    '| Sink and tap | Screwfix | Ordered | 315 |\n| Lighting | Screwfix | Quoted | 148 |\n' +
    '| Electrician | Mark Ellis | Booked | 450 |\n| Paint | B&Q | To buy | 64 |\n' +
    '| Total |  |  | =SUM(D:D) |\n| Average |  |  | =AVERAGE(D:D) |\n\n' +
    '## Still to decide\n\n- [x] Worktop finish\n- [ ] Grout colour\n',
  'Car/mot-and-tyres.md': fm('MOT and tyres', '2026-10-02T08:15:00Z', ['Car']) +
    'MOT due **3 March**.\n\n' +
    '<!-- commitbook:sheet {"totals":1,"formats":{"3":"gbp"}} -->\n' +
    '| Garage | Tyre | Price each | Fitted pair |\n| --- | --- | --- | --- |\n' +
    '| Kwik Fit | Michelin Primacy 4 | 118 | =C1*2 |\n| Halfords | Michelin Primacy 4 | 112 | =C2*2 |\n| Local (Plympton) | Michelin Primacy 4 | 105 | =C3*2 |\n' +
    '| Cheapest pair |  |  | =MIN(D:D) |\n',
};
