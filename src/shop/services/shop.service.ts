import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateProductDto } from '../dtos/update-product.dto';
import { CreateProductDto } from '../dtos/create-product.dto';
import { Product } from '../entities/product.entity';
import { ProductSize } from '../entities/product-size.entity';

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,

    @InjectRepository(ProductSize)
    private readonly productSizeRepository: Repository<ProductSize>,
  ) {}

  async fetchProducts() {
    return await this.productRepository.find({ relations: ['sizes'] });
  }

  async fetchOneProduct(id: number) {
    const product = await this.productRepository.findOne({ where: { id }, relations: ['sizes'] });
    if (!product) {
      throw new NotFoundException(`Product not found with id ${id}`);
    }
    return product;
  }

  async createProduct(createProductDto: CreateProductDto): Promise<Product> {
    const { sizes, ...productData } = createProductDto;

    const product = this.productRepository.create(productData);
    await this.productRepository.save(product);

    if (sizes && sizes.length > 0) {
      const productSizes = sizes.map(size => this.productSizeRepository.create({ ...size, product }));
      await this.productSizeRepository.save(productSizes);
    }

    return product;
  }

  async updateProduct(id: number, updateProductDto: UpdateProductDto) {
    // Fetch the product with existing sizes
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['sizes'],
    });
  
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  
    const { sizes, ...updateData } = updateProductDto;
  
    // Update the product entity
    Object.assign(product, updateData);
    await this.productRepository.save(product);
  
    if (sizes) {
      // Create a map of existing sizes for quick lookup
      const existingSizesMap = new Map(product.sizes.map(size => [size.size, size.id]));
  
      // Update existing sizes and create new sizes
      const updatedSizeIds = new Set<number>();
  
      for (const size of sizes) {
        if (existingSizesMap.has(size.size)) {
          // Update existing size
          await this.productSizeRepository.update(existingSizesMap.get(size.size), size);
          updatedSizeIds.add(existingSizesMap.get(size.size));
        } else {
          // Create new size
          const newSize = this.productSizeRepository.create({ ...size, product });
          await this.productSizeRepository.save(newSize);
          updatedSizeIds.add(newSize.id);
        }
      }
  
      // Delete sizes that were not updated or created
      const sizesToDelete = product.sizes
        .filter(existingSize => !updatedSizeIds.has(existingSize.id))
        .map(existingSize => existingSize.id);
  
      if (sizesToDelete.length > 0) {
        await this.productSizeRepository.delete(sizesToDelete);
      }
    }
  
    this.logger.log(`Updating product: ${JSON.stringify(product)}`);
    return this.fetchOneProduct(id);
  }
  

  async deleteProduct(id: number) {
    // Find the product to ensure it exists
    const product = await this.fetchOneProduct(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Delete associated sizes first
    await this.productSizeRepository.delete({ product: { id } });

    // Perform the deletion by specifying the exact ID
    const deleteResult = await this.productRepository.delete(id);

    // Check if the deletion was successful
    if (deleteResult.affected === 0) {
      throw new NotFoundException('Product not found in db');
    }

    return { message: 'Product deleted successfully' };
  }
}
