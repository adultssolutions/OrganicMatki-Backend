import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './entities/orderitem.entity';
import { CustomerOrders } from './entities/orders.entity';
import { User } from 'src/user/user.entity';
import { Product } from 'src/shop/entities/product.entity';
import { ProductSize } from 'src/shop/entities/product-size.entity';

const Razorpay = require('razorpay');
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private razorpay: any;
  constructor(
    @InjectRepository(CustomerOrders)
    private readonly orderRepository: Repository<CustomerOrders>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductSize)
    private readonly productSizeRepository: Repository<ProductSize>,
  ) {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_API_KEY_ID,
      key_secret: process.env.RAZORPAY_API_KEY_SECRET,
    });
  }

  async applyPromoCode(promoCode: string, amount: number): Promise<number> {
    const promoCodes = {
      Bundelkhand10: 10,
      Bundelkhand25: 25,
      Bundelkhand50: 50,
      Bundelkhand80: 80,
      Bundelkhand100: 100,
    };

    const discount = promoCodes[promoCode];

    if (discount) {
      const discountedAmount = amount - (amount * discount) / 100;
      return Math.round(discountedAmount); // Round off to nearest integer if needed
    }

    return amount; // No discount applied if promo code is invalid
  }

  async createOrder(firebaseUid: string | null, items: any[], OrderInfo: any) {
    // Construct the order object with the billing details
    const orderObject = {
      Name: `${OrderInfo.firstName} ${OrderInfo.lastName}`,
      CompanyName: OrderInfo.companyName || null,
      Country: OrderInfo.country,
      StreetAddress: `${OrderInfo.streetAddress}, ${OrderInfo.apartment || ''}`,
      City: OrderInfo.city,
      State: OrderInfo.state,
      Pincode: OrderInfo.pinCode,
      PaymentMethod: OrderInfo.paymentMethod,
      Phone: OrderInfo.phone,
      Email: OrderInfo.email,
      OrderNotes: OrderInfo.orderNotes || null,
    };

    this.logger.log(orderObject);

    const allProducts = await Promise.all(
      items.map(async (item: any) => {
        this.logger.log(item);

        // Find the product by productId
        const product = await this.productRepository.findOne({
          where: { id: item.productId },
          relations: ['sizes'], // Include the sizes relation
        });

        if (!product) {
          throw new Error(`Product not found for ID ${item.productId}`);
        }

        // Find the size object within the sizes array that matches the item.size
        const productSizeInfo = product.sizes.find(
          (size) => size.size === item.size,
        );

        if (!productSizeInfo) {
          throw new Error(
            `Product size not found for product ID ${item.productId} and size ${item.size}`,
          );
        }

        this.logger.log('product', productSizeInfo.product);

        const orderItem = this.orderItemRepository.create({
          productId: product.id,
          name: product.name,
          size: productSizeInfo.size,
          price: productSizeInfo.discountPrice,
          quantity: item.quantity,
          totalPrice: item.quantity * productSizeInfo.discountPrice,
          imageUrl: product.imageUrl[0], // Assuming imageUrl is a string array in Product
        });

        return orderItem;
      }),
    );

    // Calculate total price of all products
    const initialAmount = allProducts.reduce(
      (acc, item) => acc + item.totalPrice,
      0,
    );

    // Apply promo code to get the discounted amount
    let discountedAmount = initialAmount;
    if (OrderInfo.promoCode) {
      discountedAmount = await this.applyPromoCode(
        OrderInfo.promoCode,
        initialAmount,
      );
    }

    // Calculate tax and shipping based on discounted amount
    const taxPercentage = parseFloat(process.env.TAX_PERCENTAGE) || 0;
    const shipmentCharges = parseFloat(process.env.SHIPMENT_CHARGES) || 0;
    const noOfproducts = parseInt(process.env.NO_OF_PRODUCTS, 10) || 0;

    const amountWithTax =
      discountedAmount + discountedAmount * (taxPercentage / 100);
    const totalAmountBeforeShipping = Math.round(amountWithTax);

    // Determine if shipping charge applies
    const totalAmountAfterShipping =
      items.length <= noOfproducts
        ? totalAmountBeforeShipping + shipmentCharges
        : totalAmountBeforeShipping;

    // Add cash-on-delivery charges if applicable
    let finalAmount = totalAmountAfterShipping;
    if (OrderInfo.paymentMethod === 'cashOnDelivery') {
      const cashOnDeliveryCharges =
        parseFloat(process.env.CASH_ON_DELIVERY_CHARGES) || 0;
      finalAmount += cashOnDeliveryCharges;
    }

    // Create the Razorpay order with the final calculated amount
    const razorpayOrder = await this.razorpay.orders.create({
      amount: finalAmount * 100, // Amount in paise
      currency: 'INR',
      receipt: `order_${Date.now()}`,
    });

    const razorpayOrderId = razorpayOrder.id;

    // Create and save the order in the database
    const order = this.orderRepository.create({
      firebaseUid,
      orderInfo: orderObject,
      items: allProducts,
      totalAmount: finalAmount,
      razorpayOrderId,
    });

    const result = await this.orderRepository.save(order);
    return { result, razorpayOrderId };
  }

  async confirmPayment(paymentDetails: any) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } =
      paymentDetails;

    const order = await this.orderRepository.findOneBy({ razorpayOrderId });

    if (!order) {
      throw new Error('Order not found');
    }

    order.paymentStatus = 'confirmed';
    await this.orderRepository.save(order);

    return { success: true };
  }

  async fetchOrders(objectinput: any) {
    const orders = await this.orderRepository.find({
      where: {
        firebaseUid: objectinput.firebaseUid,
        paymentStatus: 'confirmed',
      },
      relations: ['items'],
    });
    return orders;
  }
}
