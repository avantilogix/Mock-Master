export function approvedCourseOrder(order) {
  return typeof order?.payment === 'string' && order.payment.length > 0 &&
    (order.paymentStatus === 'approved' || order.paymentStatus == null);
}
