import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { StockService } from './stock.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// Every route here runs behind the full guard chain (docs/Action Plan.md §4):
// JwtAuthGuard -> ModuleEntitlementGuard -> PermissionGuard -> SiteScopeGuard.
@Controller('stock')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('categories')
  @RequiresPermission('stock', 'stock.product.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('product_category', 'stock.category.created')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.stock.createCategory(user.orgId, dto);
  }

  @Get('categories')
  @RequiresPermission('stock', 'stock.product.read')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.stock.listCategories(user.orgId);
  }

  @Post('products')
  @RequiresPermission('stock', 'stock.product.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('product', 'stock.product.created')
  createProduct(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.stock.createProduct(user.orgId, dto);
  }

  // ?siteId=<id>|all — matches docs/Wireframes.html's site selector,
  // including the "Tous les sites" option (adds the Site column there; here
  // it's simply one row per product-per-visible-site instead of one row
  // per product). Named `siteId` (not `site`) so the guard chain's
  // `req.query?.siteId` reader — the same field name it already reads from
  // params/body — picks it up without a second special case.
  @Get('products')
  @RequiresPermission('stock', 'stock.product.read')
  listProducts(@CurrentUser() user: AuthenticatedUser, @Query('siteId') siteId = 'all') {
    return this.stock.listProducts(user.orgId, user.userId, siteId);
  }

  @Get('products/:id')
  @RequiresPermission('stock', 'stock.product.read')
  getProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stock.getProductDetail(user.orgId, id);
  }

  @Patch('products/:id')
  @RequiresPermission('stock', 'stock.product.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('product', 'stock.product.updated')
  updateProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.stock.updateProduct(user.orgId, id, dto);
  }

  @Post('movements')
  @RequiresPermission('stock', 'stock.movement.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('stock_movement', 'stock.movement.created')
  recordMovement(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordMovementDto) {
    return this.stock.recordMovement(user.orgId, user.userId, dto);
  }

  @Get('movements')
  @RequiresPermission('stock', 'stock.movement.read')
  listMovements(@CurrentUser() user: AuthenticatedUser, @Query('siteId') siteId?: string, @Query('productId') productId?: string) {
    return this.stock.listMovements(user.orgId, { siteId, productId });
  }

  @Post('inventory-adjustments')
  @RequiresPermission('stock', 'stock.inventory.adjust')
  @UseInterceptors(AuditInterceptor)
  @Audit('stock_movement', 'stock.inventory.adjusted')
  createInventoryAdjustment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInventoryAdjustmentDto) {
    return this.stock.createInventoryAdjustment(user.orgId, user.userId, dto);
  }
}
