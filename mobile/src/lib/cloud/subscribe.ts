import { purchasesAvailable } from '@/lib/cloud/purchases';
import { showAlert } from '@/lib/i18n';

/**
 * 구독(결제)으로 이어지는 버튼을 눌렀을 때 부른다. 결제를 연 빌드면 `open`(보통 안전 보관 화면으로 이동)을 하고,
 * 아직 결제를 열지 않은 빌드면 화면을 옮기지 않고 준비 중이라고 알린다.
 * 로그인하지 않은 사람의 [안전 보관 알아보기]처럼 로그인으로 이어지는 버튼에는 쓰지 않는다 (로그인은 지금도 된다).
 */
export function openSubscription(open: () => void) {
  if (purchasesAvailable) {
    open();
    return;
  }
  showAlert('안전 보관 구독은 준비하고 있어요', '지금은 이 계정에 기록을 무료로 백업하고 있어요.');
}
