import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';

// Which lines (and how much of each) to pull from a commande into a new
// draft CUSTOMER invoice — a commande can be invoiced partially, more than
// once over time (mirrors PurchaseReceipt's own partial-vs-PurchaseOrder
// shape). Each quantity is validated against that line's own remaining
// (quantityOrdered - quantityInvoiced) in SalesService.invoiceSalesOrder.
export class InvoiceSalesOrderLineDto {
  @IsString()
  salesOrderLineId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class InvoiceSalesOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceSalesOrderLineDto)
  lines!: InvoiceSalesOrderLineDto[];
}
