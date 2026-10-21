const ITEM_CODE_PREFIX = 'ITEM-';
const ITEM_CODE_WIDTH = 6;

export function formatItemCode(sequence: number) {
  return `${ITEM_CODE_PREFIX}${String(sequence).padStart(ITEM_CODE_WIDTH, '0')}`;
}

export function parseItemCodeSequence(itemCode: string | undefined) {
  if (itemCode === undefined) return null;
  const match = /^ITEM-(\d+)$/.exec(itemCode);
  if (match === null) return null;
  return Number(match[1]);
}

export function findLatestItemCodeSequence(items: Array<{ itemCode: string }>) {
  let maxNum = 0;
  for (const item of items) {
    const sequence = parseItemCodeSequence(item.itemCode);
    if (sequence !== null && sequence > maxNum) {
      maxNum = sequence;
    }
  }
  return maxNum;
}
