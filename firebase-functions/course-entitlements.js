export function approvedCourseOrder(order) {
  return typeof order?.payment === 'string' && order.payment.trim().length > 0 &&
    order.paymentStatus === 'approved';
}

export function legacyCourseOrder(order) {
  return order?.paymentStatus == null && typeof order?.payment === 'string' && order.payment.trim().length > 0;
}

export function isPublicResourceTest(courseId, resourceId) {
  return courseId === 'public-current-affairs' && Boolean(resourceId);
}
