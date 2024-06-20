/* Copyright 2023 Aures Tic - Jose Zambudio
   License LGPL-3.0 or later (https://www.gnu.org/licenses/lgpl). */

odoo.define("pos_order_mgmt.RefundOrderButton", function (require) {
    "use strict";

    const core = require("web.core");
    const {useContext} = owl.hooks;
    const PosComponent = require("point_of_sale.PosComponent");
    const OrderManagementScreen = require("point_of_sale.OrderManagementScreen");
    const Registries = require("point_of_sale.Registries");
    const contexts = require("point_of_sale.PosContext");
    const _t = core._t;

    class RefundOrderButton extends PosComponent {
        constructor() {
            super(...arguments);
            this.orderManagementContext = useContext(contexts.orderManagement);
        }
        async onClick() {
            const refund_order = this.orderManagementContext.selectedOrder;
            if (!refund_order) return;

            var refunded_orders = [];
            var related_domain = [['related_order', '=', refund_order.account_move_name]];
            var related_field = ['related_order', 'amount_paid']

            // Se asigna la instancia de la clase OrderManagementScreen a una variable que va a contener las ordenes de la base de datos.
            // const ordenes_database = this.orders

            if(refund_order.document_type == 'ncde' || refund_order.document_type == 'c'){
                return this.showPopup('ErrorPopup', {
                    'title': _t('Nota Crédito'),
                    'body': _t(`La orden seleccionada es una Nota Crédito, no se puede realizar una devolución.`),
                    cancel: function(){
                        this.showScreen('OrderManagementScreen');
                    },
                });
            } 
            else if (refund_order.document_type === 'dee' || refund_order.document_type === 'f') {
                try {
                    const output = await this.rpc({
                        model: 'pos.order',
                        method: 'search_read',
                        args: [related_domain, related_field]
                    });           
                    refunded_orders.push(...output);
                } catch (error) {
                    console.error('Error fetching related orders:', error);
                }
            }
            
            if (refunded_orders.length > 0) {

                let monto_reembolsado = refunded_orders.reduce((total, order) => total + Math.abs(order['amount_paid']), 0);
                monto_reembolsado = Math.round(monto_reembolsado * 100) / 100;
                // En monto reembolsado se suman todos los campos amount_paid de las NCDE asociadas al DEE y se redonde a dos decimales.
                let monto_a_reembolsar = refund_order.paymentlines.models[0].amount;
                monto_a_reembolsar = Math.round(monto_a_reembolsar * 100) / 100;
                // En monto a reembolsar se toma el valor del pago total de la orden seleccionada y se redondea a dos decimales.

                if (monto_reembolsado === monto_a_reembolsar) { // Ojo, usar operador de comparacion '===' , no de asignacion.
                    return this.showPopup('ErrorPopup', {
                        'title': _t('Nota Crédito'),
                        'body': _t(`La orden ${refund_order.account_move_name} ya ha sido devuelta en su totalidad.`),
                        cancel: function(){
                            this.showScreen('OrderManagementScreen');
                        },
                    });
                }
                else if (monto_reembolsado < monto_a_reembolsar) {
                        this.showPopup('ErrorPopup', {
                            'title': _t('Nota Crédito'),
                            'body': _t(`La orden ${refund_order.account_move_name} ya ha sido parcialmente reembolsada por un valor de $ ${monto_reembolsado}. Valor restante para devolucion: $ ${monto_a_reembolsar - monto_reembolsado}`)
                    });
                }
            }

            const order = this._prepare_order_from_order(refund_order);
            this.env.pos.set_order(order);
            order.trigger("change");
            this.showScreen("ProductScreen");
        }
        _prepare_order_from_order(refund_order) {
            var {pos} = this.env;
            var order = pos.add_new_order({silent: true});

            // Get Customer
            if (refund_order.partner_id) {
                order.set_client(pos.db.get_partner_by_id(refund_order.partner_id));
            }

            // Get fiscal position
            if (refund_order.fiscal_position && pos.fiscal_positions) {
                var fiscal_positions = pos.fiscal_positions;
                order.fiscal_position = fiscal_positions.filter(function (p) {
                    return p.id === refund_order.fiscal_position;
                })[0];
                order.trigger("change");
            }

            // Get order lines
            this._prepare_orderlines_from_order(order, refund_order);

            // Get Name
            //order.name = _t("Refund ") + refund_order.uid;

            // Get to invoice
            order.set_to_invoice(refund_order.to_invoice);

            // Get returned Order
            order.returned_order_id = refund_order.backendId;

            // Se prepara refundOrder con los campos de la orden original            
            order.attributes = refund_order.attributes
            order.Resolution = refund_order.Resolution
            order.state = refund_order.state

            // Se agrega la recuperacion de account_move_name con el objetivo de darle a la Nota de Credito 
            // un campo que la pueda asociar con la orden original. Esto nos permite que al momento de hacer 
            // la devolucion, se pueda asociar la Nota de Credito con la Factura original y asi poder verificar 
            // si existen o no devoluciones parciales o totales de la factura original.
            order.related_order = refund_order.account_move_name

            return order;
        }
        _prepare_orderlines_from_order(order, refund_order) {
            refund_order.get_orderlines().forEach(function (orderline) {
                var product = orderline.product;
                var quantity = orderline.quantity;
                order.add_product(product, {
                    price: orderline.price_unit,
                    quantity: quantity * -1,
                    discount: orderline.discount,
                    merge: false,
                    extras: {
                        return_pack_lot_names: orderline.pack_lot_names,
                    },
                });
            });
        }
    }

    RefundOrderButton.template = "RefundOrderButton";

    OrderManagementScreen.addControlButton({
        component: RefundOrderButton,
        condition: function () {
            return this.env.pos.config.iface_return_done_order;
        },
    });

    Registries.Component.add(RefundOrderButton);

    return RefundOrderButton;
});
