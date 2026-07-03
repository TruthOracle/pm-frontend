export function getCurrentPrice(qYes: number, qNo: number, b: number) {
  if (!b || b === 0) return { yes: 0.5, no: 0.5 };
  const eYes = Math.exp(qYes / b);
  const eNo = Math.exp(qNo / b);
  return { yes: eYes / (eYes + eNo), no: eNo / (eYes + eNo) };
}

export function formatCents(price: number) {
  return `${Math.round(price * 100)}¢`;
}
