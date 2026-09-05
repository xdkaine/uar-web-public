export default function RequestDetailField({
  label,
  children,
  className = '',
  valueClassName = 'text-sm sm:text-base text-foreground font-semibold',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground text-xs sm:text-sm font-medium">{label}</dt>
      <dd className={valueClassName}>{children}</dd>
    </div>
  );
}
