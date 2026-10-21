export function touchMonthRange(month:string){
  const [year,value]=month.split('-').map(Number);
  if(!Number.isInteger(year)||year<2000||year>2100||value<1||value>12)throw new Error('잘못된 조회 월입니다.');
  return {from:new Date(Date.UTC(year,value-1,1,-9)).toISOString(),until:new Date(Date.UTC(year,value,1,-9)).toISOString()};
}
