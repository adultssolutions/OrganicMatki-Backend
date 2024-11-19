require('dotenv').config();
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './entities/orderitem.entity';
import { CustomerOrders } from './entities/orders.entity';
import { User } from 'src/user/user.entity';
import { Product } from 'src/shop/entities/product.entity';
import { ProductSize } from 'src/shop/entities/product-size.entity';
import * as sgMail from '@sendgrid/mail';
import axios from 'axios';

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

  private async createShipment(order: CustomerOrders, paymentMethod: string, items: any[]) {
    const currentDate = new Date();
    const endDate = new Date(currentDate);
    endDate.setDate(currentDate.getDate() + 5); // Add 5 days for delivery window

    // Function to generate a unique order ID
    const generateUniqueOrderId = () => {
      return `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    };

    // Build the shipments array from order items
    const shipments = items.map((item) => ({
      name: order.orderInfo.Name,
      add: order.orderInfo.StreetAddress,
      pin: order.orderInfo.Pincode,
      city: order.orderInfo.City,
      state: order.orderInfo.State,
      country: order.orderInfo.Country,
      phone: order.orderInfo.Phone,
      order_date: currentDate.toISOString(),
      end_date: endDate.toISOString(),
      order: generateUniqueOrderId(), // Generate a unique order ID
      payment_mode: paymentMethod === 'cashOnDelivery' ? 'COD' : 'Prepaid',
      cod_amount: paymentMethod === 'cashOnDelivery'
        ? (item.quantity * parseFloat(item.discountPrice)).toString()
        : '0',
      hsn_code: '',
      total_amount: (item.quantity * parseFloat(item.discountPrice)).toString(),
      seller_add: '', // Seller address
      seller_name: '', // Seller name
      seller_inv: '', // Seller invoice number
      quantity: item.quantity.toString(),
      waybill: '', // Waybill number
      shipment_width: '10', // Shipment package width in cm
      shipment_height: '10', // Shipment package height in cm
      weight: '500', // Shipment weight in grams
      seller_gst_tin: '', // Seller GSTIN number
      shipping_mode: 'Express',
      address_type: 'home',
      return_pin: '', // Return pincode
      return_city: '', // Return city
      return_phone: '', // Return phone number
      return_add: '', // Return address
      return_state: '', // Return state
      return_country: '', // Return country
      products_desc: '',
    }));

    console.log('Payload:', shipments);

    const shipmentPayload = {
      shipments,
      pickup_location: {
        name: 'Organic Matki',
        add: 'Nizami palace, Near zila parishad chauraha, Banda',
        city: 'Banda',
        pin_code: '210001',
        country: 'India',
        phone: '9721701572',
      },
    };

    try {
      const response = await axios.post(
        'https://staging-express.delhivery.com/api/cmu/create.json',
        {
          format: 'JSON',
          data: shipmentPayload,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Token 14b692578098e60b947eced27aa9896d03496730`,
          },
        }
      );
      console.log('Shipment created successfully', response.data);
    } catch (error) {
      if (error.response) {
        console.log('Error creating shipment', error.response.data);
      } else {
        console.log('Error creating shipment', error);
      }
      throw new Error('Failed to create shipment');
    }
  }




  async createOrder(firebaseUid: string | null, items: any[], OrderInfo: any) {
    const promoCodes = {
      Bundelkhand10: 10,
      Bundelkhand25: 25,
      Bundelkhand50: 50,
      Bundelkhand80: 80,
      Bundelkhand100: 100,
    };
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
          // Calculate total price with promo code if applicable
          totalPrice: item.quantity * productSizeInfo.discountPrice,
          imageUrl: productSizeInfo.imageUrl[0], // Assuming imageUrl is a string array in Product
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
    console.log("promocode", OrderInfo.promoCode)
    if (OrderInfo.promoCode) {
      this.logger.log("promo code :", OrderInfo.promoCode)
      discountedAmount = await this.applyPromoCode(
        OrderInfo.promoCode,
        initialAmount,
      );
      console.log("disc", discountedAmount)
    }

    // Calculate tax and shipping based on discounted amount
    // const taxPercentage = parseFloat(process.env.TAX_PERCENTAGE) || 0;
    const shipmentCharges = parseFloat(process.env.SHIPMENT_CHARGES) || 0;
    const noOfproducts = parseInt(process.env.NO_OF_PRODUCTS, 10) || 0;

    // const amountWithTax =
    //   discountedAmount + discountedAmount * (taxPercentage / 100);
    const totalAmountBeforeShipping = Math.round(discountedAmount);

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
    // if (OrderInfo.paymentMethod === "cashOnDelivery") {
    //   await this.createShipment(order, OrderInfo.paymentMethod, items)
    // }

    return { result, razorpayOrderId };
  }

  async confirmPayment(paymentDetails: any) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethod, items } =
      paymentDetails;

    const order = await this.orderRepository.findOneBy({ razorpayOrderId });

    if (!order) {
      throw new Error('Order not found');
    }

    order.paymentStatus = 'confirmed';
    // await this.createShipment(order, paymentMethod, items)
    await this.orderRepository.save(order);

    return { success: true };
  }

  async fetchOrders(objectinput: any) {
    // firebaseUid1.toString().trim();
    const orders = await this.orderRepository.find({
      // where: { firebaseUid: objectinput.firebaseUid, paymentStatus: "confirmed" },
      //  where :{ paymentStatus : "confirmed"},
      relations: ['items'],
    });
    return orders;
  }

  async emailService(body: any) {
    console.log('testing the email service');

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('emailservice called');
    //    const currentDate = new Date().toLocaleString();
    const currentDate = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
    });

    const ComfirmOrder_msg = {
      to: `${body.recipient}`, // Change to your recipient
      from: 'contact@organicmatki.in', // Change to your verified sender
      subject: 'Your order is confirmed',
      text: 'and easy to do anywhere, even with Node.js',
      html: `<div style="font-family: inherit; text-align: inherit">Dear ${body.recipientName},<br>
          <br>
          Thank you for shopping with us!<br>
          <br>
          We are thrilled to confirm that your ${body.OrderId} has been successfully placed. Below are the details of your order:<br>
          <br>
          Order Summary:<br>
          <br>
          - Order Date: ${currentDate}<br>
          - Order Number: ${body.OrderId}<br>
          - Total Amount: Rs. ${body.OrderAmount}<br>
          - Payment Method: ${body.PaymentMethod === "cashOnDelivery" ? "Cash on delivery":body.paymentMethod}<br>
          Order Items:<br>
          <ul>
          ${body.OrderItems.map(
        (item) => `
            <li>
              Product Name: ${item.name}<br>
              Quantity: ${item.quantity}<br>
              Price: ${item.discountprice}<br>
            </li>
          `,
      ).join('')}
          </ul>
          Shipping Address: ${body.OrderAddress}<br>
          <br>
          Thank you for choosing us! Our team will process your order promptly.<br>
          <br>
          Best regards,</div>
          <div style="font-family: inherit; text-align: inherit">Organic Matki</div>`,
    };

    console.log(ComfirmOrder_msg);

    try {
      await sgMail.send(ComfirmOrder_msg);
      console.log('Email sent');
      return { success: true, message: 'Email sent successfully' };
    } catch (error) {
      console.error(error);
      return { success: false, message: 'Failed to send email', error };
    }
  }
}