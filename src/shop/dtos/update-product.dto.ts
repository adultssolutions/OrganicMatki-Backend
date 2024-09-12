import {
  IsArray,
  IsDecimal,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateProductSizeDto {
  @IsString()
  size?: string;

  @IsNumber()
  price?: number;

  @IsNumber()
  discountPrice?: number;
}

export class UpdateProductDto {
  @IsNumber()
  id: number;

  @IsString()
  name?: string;

  @IsString()
  category?: string;

  @IsString()
  sku?: string;

  @IsString()
  origin?: string;

  @IsString()
  benefits?: string;

  @IsString()
  uses?: string;

  @IsString()
  ingredients?: string;

  @IsString()
  safetyInformation?: string;

  @IsString()
  video1?: string;

  @IsString()
  video2?: string;

  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductSizeDto)
  sizes?: UpdateProductSizeDto[];

  @IsArray()
  @IsString({ each: true })
  imageUrl?: string[];

  @IsString()
  bannerUrl?: string;
}
