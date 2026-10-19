// "Cartons" helper for line-item editors: typing N cartons sets the line's
// quantity to N × the product's unitsPerCarton. Nothing about cartons is
// stored on the line — the quantity (in units) stays the single source of
// truth, and this field just shows it back as quantity ÷ unitsPerCarton.
export function CartonInput({
  unitsPerCarton,
  quantity,
  onQuantityChange,
}: {
  unitsPerCarton: number | null | undefined;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
}) {
  if (!unitsPerCarton) {
    return (
      <input
        className="control li-num"
        disabled
        placeholder="—"
        aria-label="Cartons"
        title="Renseignez « Unités par carton » sur la fiche produit pour saisir en cartons."
      />
    );
  }
  const cartons = Math.round((quantity / unitsPerCarton) * 100) / 100;
  return (
    <input
      type="number"
      min={0}
      step="any"
      className="control li-num"
      value={quantity ? cartons : ''}
      onChange={(e) => onQuantityChange(e.target.value === '' ? 0 : Number(e.target.value) * unitsPerCarton)}
      placeholder="Cartons"
      aria-label="Cartons"
      title={`${unitsPerCarton} unités par carton`}
    />
  );
}
