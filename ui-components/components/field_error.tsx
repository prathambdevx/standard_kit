export const FieldError = ({
  error,
  align = 'left',
}: {
  error: string | null | undefined;
  align?: 'left' | 'center';
}) => {
  if (!error) return null;
  return (
    <p
      key={error}
      role="alert"
      className={`animate-error-in fl-text-[12,12] leading-none tracking-[0.03em] text-[#D81820] capitalize ${align === 'center' ? 'text-center' : ''}`}
    >
      {error}
    </p>
  );
};
