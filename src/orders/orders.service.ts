import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {OrderItem} from './entities/orderitem.entity';
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
          (size) => size.size === item.size
        );
  
        if (!productSizeInfo) {
          throw new Error(
            `Product size not found for product ID ${item.productId} and size ${item.size}`
          );
        }
  
        this.logger.log("product", productSizeInfo.product);
  
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

    const finalAmount = allProducts.reduce(
      (acc, item) => acc + item.totalPrice,
      0,
    );
    const taxPercentage = process.env.TAX_PERCENTAGE
    const shipmentCharges = process.env.SHIPMENT_CHARGES
    const noOfproducts = process.env.NO_OF_PRODUCTS
    const totalAmountBeforeShipping: number = parseInt(
      (finalAmount + finalAmount * parseFloat(taxPercentage)).toFixed(0),
    );
    const totalAmountAfterShipping = items.length <= parseInt(noOfproducts) ? totalAmountBeforeShipping + parseFloat(shipmentCharges) : totalAmountBeforeShipping

    
    // Create the order entity
    let razorpayOrderId: string | null = null;
    const cashOnDeliveryCharges = process.env.CASH_ON_DELIVERY_CHARGES
      const razorpayOrder = await this.razorpay.orders.create({
        amount: OrderInfo.paymentMethod === 'cashOnDelivery' ? parseFloat(cashOnDeliveryCharges) * 100 : totalAmountAfterShipping * 100, // Amount in the smallest currency unit (e.g., paise for INR)
        currency: 'INR',
        receipt: `order_${Date.now()}`,
      });
      console.log(razorpayOrder)
      razorpayOrderId = razorpayOrder.id;
    

    const order = this.orderRepository.create({
      firebaseUid,
      orderInfo: orderObject,
      items: allProducts,
      totalAmount:totalAmountAfterShipping,
      razorpayOrderId, // Store the Razorpay order ID or null
    });

    const result = await this.orderRepository.save(order);

    console.log(result);
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
    // firebaseUid1.toString().trim();
    const orders = await this.orderRepository.find({
     // where: { firebaseUid: objectinput.firebaseUid, paymentStatus: "confirmed" },
      where :{ paymentStatus : "confirmed"},
      relations: ['items'],
    });
    return orders;
}
}
