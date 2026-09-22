// KRW, tax-exclusive planning model. See docs/contract.md for boundaries.
export const DEFAULT_INPUT = Object.freeze({
  name: '나의 작은 카페', businessType: 'cafe', price: 6500, dailySales: 75, days: 26,
  unitCost: 2200, feePct: 2, rent: 1500000, labor: 1800000, otherFixed: 650000,
  ownerPay: 3000000, startupCost: 20000000, deposit: 10000000, availableCash: 40000000,
  firstMonthPct: 60, growthPct: 15,
});

export const PRESETS = Object.freeze([
  { id: 'cafe', label: '카페', description: '음료 한 주문 기준', input: { ...DEFAULT_INPUT } },
  { id: 'shop', label: '온라인 판매', description: '상품 한 주문 기준', input: {
    ...DEFAULT_INPUT, name: '나의 온라인 상점', businessType: 'shop', price: 32000,
    dailySales: 12, days: 30, unitCost: 18000, feePct: 6, rent: 0, labor: 0,
    otherFixed: 1000000, ownerPay: 2500000, startupCost: 3000000, deposit: 0,
    availableCash: 10000000, firstMonthPct: 50, growthPct: 20,
  } },
  { id: 'class', label: '공방·클래스', description: '수강생 한 명 기준', input: {
    ...DEFAULT_INPUT, name: '나의 원데이 클래스', businessType: 'class', price: 55000,
    dailySales: 6, days: 16, unitCost: 16000, feePct: 3, rent: 600000, labor: 0,
    otherFixed: 450000, ownerPay: 2200000, startupCost: 4000000, deposit: 3000000,
    availableCash: 12000000, firstMonthPct: 50, growthPct: 20,
  } },
  { id: 'service', label: '1인 서비스', description: '작업·상담 한 건 기준', input: {
    ...DEFAULT_INPUT, name: '나의 1인 스튜디오', businessType: 'service', price: 180000,
    dailySales: 2, days: 20, unitCost: 20000, feePct: 3, rent: 0, labor: 0,
    otherFixed: 650000, ownerPay: 3000000, startupCost: 2500000, deposit: 0,
    availableCash: 8000000, firstMonthPct: 40, growthPct: 20,
  } },
]);

const constraints = {
  price: [1, 1e9, '판매 가격', true], dailySales: [0, 100000, '하루 판매량', true],
  days: [1, 31, '월 영업일', true], unitCost: [0, 1e9, '건당 원가', true],
  feePct: [0, 100, '수수료율'], rent: [0, 1e12, '월 임대료', true],
  labor: [0, 1e12, '직원 인건비', true], otherFixed: [0, 1e12, '기타 고정비', true],
  ownerPay: [0, 1e12, '사장님 목표 소득', true], startupCost: [0, 1e12, '초기 투자비', true],
  deposit: [0, 1e12, '보증금', true], availableCash: [0, 1e12, '총 준비 자금', true],
  firstMonthPct: [0, 100, '첫 달 판매 달성률'], growthPct: [0, 100, '월 판매 증가율'],
};

export function validate(input) {
  const errors = {};
  const x = input && typeof input === 'object' ? input : {};
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 80) errors.name = '사업 이름을 1~80자로 입력해 주세요.';
  if (!['cafe', 'shop', 'class', 'service'].includes(x.businessType)) errors.businessType = '사업 유형을 선택해 주세요.';
  for (const [key, [min, max, label, integer]] of Object.entries(constraints)) {
    const value = x[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) errors[key] = `${label}를 숫자로 입력해 주세요.`;
    else if (value < min || value > max) errors[key] = `${label}: ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 범위로 입력해 주세요.`;
    else if (integer && !Number.isInteger(value)) errors[key] = `${label}는 정수로 입력해 주세요.`;
  }
  if (!Object.keys(errors).length) {
    const annualArithmeticBudget = ((x.price + x.unitCost + x.price * x.feePct / 100)
      * x.dailySales * x.days * 1.2 + x.rent + x.labor + x.otherFixed + x.ownerPay) * 12
      + x.availableCash + x.startupCost + x.deposit;
    if (annualArithmeticBudget > Number.MAX_SAFE_INTEGER) {
      errors.dailySales = '12개월 금액이 안전한 계산 범위를 넘습니다. 판매가·원가·판매량을 낮춰 주세요.';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function check(input) {
  const result = validate(input);
  if (!result.valid) throw new RangeError(Object.values(result.errors).join(' '));
}

function threshold(costs, contribution) {
  if (contribution > 0) return costs / contribution;
  if (contribution === 0 && costs === 0) return 0;
  return null;
}

function ceilUnits(value) {
  if (value === null) return null;
  // Neutralize roundoff at an exact integer boundary; never round partial units down.
  const near = Math.round(value);
  return Math.abs(value - near) <= Number.EPSILON * Math.max(1, value) * 4 ? near : Math.ceil(value);
}

function atVolume(x, units) {
  const revenue = x.price * units;
  const unitVariable = x.unitCost + x.price * x.feePct / 100;
  // Round aggregate monthly variable cost once, in whole KRW. Integer cash
  // balances avoid floating point dust being reported as a funding shortage.
  const variableCosts = Math.round(unitVariable * units);
  const fixedCosts = x.rent + x.labor + x.otherFixed;
  const operatingSurplus = revenue - variableCosts - fixedCosts;
  return { units, revenue, unitVariable, variableCosts, fixedCosts, operatingSurplus,
    ownerDraw: x.ownerPay, surplusAfterOwner: operatingSurplus - x.ownerPay };
}

export function calculate(input) {
  check(input);
  const v = atVolume(input, input.dailySales * input.days);
  const contributionPerUnit = input.price - v.unitVariable;
  const exactBreakEven = threshold(v.fixedCosts, contributionPerUnit);
  const exactTarget = threshold(v.fixedCosts + input.ownerPay, contributionPerUnit);
  const breakEvenUnits = ceilUnits(exactBreakEven);
  const targetUnits = ceilUnits(exactTarget);
  const initialOutlay = input.startupCost + input.deposit;
  return {
    ...v, contributionPerUnit, contributionMarginPct: contributionPerUnit / input.price * 100,
    breakEvenUnits, breakEvenDaily: breakEvenUnits === null ? null : Math.ceil(breakEvenUnits / input.days),
    breakEvenRevenue: exactBreakEven === null ? null : exactBreakEven * input.price,
    targetUnits, targetDaily: targetUnits === null ? null : Math.ceil(targetUnits / input.days),
    targetRevenue: exactTarget === null ? null : exactTarget * input.price,
    initialOutlay, openingCash: input.availableCash - initialOutlay,
    simplePaybackMonths: initialOutlay === 0 ? 0 : (v.surplusAfterOwner > 0 ? initialOutlay / v.surplusAfterOwner : null),
    safetyMarginPct: v.units > 0 && contributionPerUnit > 0 ? (v.units - exactBreakEven) / v.units * 100 : null,
  };
}

export function simulate(input) {
  const base = calculate(input);
  let cash = base.openingCash;
  let cumulativeRecovery = -base.initialOutlay;
  let minimumCash = cash;
  let firstShortageMonth = cash < 0 ? 0 : null;
  let recoveryMonth = base.initialOutlay === 0 ? 0 : null;
  const months = [];
  for (let month = 1; month <= 12; month++) {
    const factor = Math.min(1, input.firstMonthPct / 100 * (1 + input.growthPct / 100) ** (month - 1));
    const units = Math.floor(base.units * factor + Number.EPSILON * base.units * 4);
    const v = atVolume(input, units);
    cash += v.surplusAfterOwner;
    cumulativeRecovery += v.surplusAfterOwner;
    minimumCash = Math.min(minimumCash, cash);
    if (cash < 0 && firstShortageMonth === null) firstShortageMonth = month;
    if (cumulativeRecovery >= 0 && recoveryMonth === null) recoveryMonth = month;
    months.push({ month, factor, units, revenue: v.revenue, variableCosts: v.variableCosts,
      operatingSurplus: v.operatingSurplus, ownerDraw: v.ownerDraw, netCashFlow: v.surplusAfterOwner,
      closingCash: cash, cumulativeRecovery });
  }
  return { months, firstShortageMonth, minimumCash, endCash: cash, recoveryMonth };
}

export function compareScenarios(input) {
  check(input);
  return [
    { id: 'low', label: '판매량 20% 감소', multiplier: .8 },
    { id: 'base', label: '계획대로 판매', multiplier: 1 },
    { id: 'high', label: '판매량 20% 증가', multiplier: 1.2 },
  ].map(s => ({ ...s, ...atVolume(input, Math.floor(input.dailySales * input.days * s.multiplier + 1e-9)) }));
}
