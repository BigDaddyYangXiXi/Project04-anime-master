const presentation = require('./order-presentation');
// A response to a request is not yet an accepted cooperation.
const acceptedStages = ['IN_PRODUCTION', 'REVISION_REQUESTED', 'DELIVERY_PENDING', 'COMPLETED'];
function belongs(order, role) { return order.viewerRole === (role === 'provider' ? 'PROVIDER' : 'BUYER'); }
function needsAction(order, role) {
  const stages = role === 'provider'
    ? ['REQUESTED', 'SUPPLEMENTED', 'NDA_PROVIDER_PENDING', 'REVISION_REQUESTED']
    : ['SUPPLEMENT_REQUESTED', 'NDA_BUYER_PENDING', 'BUYER_FINAL_CONFIRM', 'DELIVERY_PENDING'];
  return stages.includes(order.stage) || role === 'buyer' && order.stage === 'COMPLETED' && !order.rating;
}
function select(orders, role, mode) {
  return orders.filter(order => belongs(order, role)).filter(order => mode === 'todo' ? needsAction(order, role)
    : mode === 'reviews' ? order.stage === 'COMPLETED'
    : mode === 'coops' && role === 'provider' ? acceptedStages.includes(order.stage) : true);
}
function destination(order, role, mode) {
  const page = mode === 'reviews' && role === 'buyer' ? 'review'
    : role === 'provider' ? order.stage === 'NDA_PROVIDER_PENDING' ? 'provider-task' : 'provider-request'
    : order.stage === 'DELIVERY_PENDING' ? 'fulfillment'
    : presentation.groupForStage(order.stage) === 'booking' ? 'booking-status' : 'order-detail';
  return `/pages/${page}/index?id=${encodeURIComponent(order.id)}`;
}
module.exports = { acceptedStages, belongs, needsAction, select, destination };
