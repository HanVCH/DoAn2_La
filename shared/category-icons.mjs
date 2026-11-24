export const categoryIcons = {
  tag: 'Khác',
  noodles: 'Ăn uống', coffee: 'Cà phê', groceries: 'Đi chợ', shopping: 'Mua sắm',
  scooter: 'Đi lại', home: 'Nhà ở', utility: 'Hóa đơn', health: 'Y tế',
  book: 'Học tập', play: 'Giải trí', gift: 'Quà tặng',
  cash: 'Thu nhập', work: 'Công việc', savings: 'Tiết kiệm',
};

// Keep rendering keys already saved by users even when the picker is curated.
const legacyCategoryIcons = new Set([
  'plus','alarm','audio','camera','video','cloud','edit','confirm','contact','calendar',
  'star','invite','location','heart','mail','pin','message','pause','prohibit','search',
  'share','shuffle','task','completed','time','update',
]);
export const isCategoryIcon = key => typeof key === 'string' && (Object.hasOwn(categoryIcons,key) || legacyCategoryIcons.has(key));

export function categoryIconFor(key,kind,name) {
  if (isCategoryIcon(key)) return key;
  if (kind === 'income') return 'cash';
  if (name === 'Ăn uống') return 'noodles';
  if (name === 'Đi lại') return 'scooter';
  return 'tag';
}
