export const touchLogoutWarning = (unsentSales: number) =>
  unsentSales > 0
    ? `보내는 중인 판매 ${unsentSales}건은 아직 저장되지 않았습니다. 같은 계정으로 다시 로그인하면 이 폰에서 이어서 보냅니다.`
    : "로그아웃하면 이 폰에서 판매를 저장할 수 없습니다. 같은 계정으로 다시 로그인해 주세요.";
