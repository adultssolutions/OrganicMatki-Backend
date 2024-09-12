import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import {OrderItem} from './orderitem.entity';

@Entity()
export class CustomerOrders {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    firebaseUid: string;

    @Column('json')
    orderInfo: Record<string, any>;

    @OneToMany(() => OrderItem, (item:OrderItem) => item.order, { cascade: true })
    items: OrderItem[];

    @Column('decimal', { precision: 10, scale: 2 })
    totalAmount: number;

    @Column({ nullable: true })
    razorpayOrderId: string | null;

    @Column({default:"failed", nullable:true})
    paymentStatus:string;

    @Column({default:"placed"})
    orderStatus:string;
    // placed , canceled , intransit , deilvered .

}
