import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@freshkirana/contracts';
import { Roles } from '../../identity/contracts';
import {
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

/**
 * Catalog governance (spec §1.5.4, §4.5).
 *
 * Admin and ops only — decision D1 puts the master catalog under central
 * control precisely so branches cannot each invent their own version of the
 * same product. Branches attach *offers* (P1.2); they do not create products.
 * Unmatched items go through the product-request queue in P1.3.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('brands')
  createBrand(@Body() dto: CreateBrandDto) {
    return this.catalog.createBrand(dto);
  }

  @Get('brands')
  listBrands() {
    return this.catalog.listBrands();
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Get('products')
  listProducts(@Query() query: ListProductsQueryDto) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.catalog.getProduct(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }
}
