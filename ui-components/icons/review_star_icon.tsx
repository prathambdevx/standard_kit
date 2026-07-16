export const ReviewStarIcon = ({
  className = '',
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M12.876 7.70312L12.9902 7.96094L13.2705 7.99609L18.7949 8.68555L14.6797 12.1162L14.4453 12.3105L14.5107 12.6084L15.918 18.9434L10.2646 15.4092L10 15.2432L9.73438 15.4092L4.08008 18.9434L5.48828 12.6084L5.55371 12.3105L5.32031 12.1162L1.2041 8.68555L6.72852 7.99609L7.00879 7.96094L7.12305 7.70312L9.99902 1.23047L12.876 7.70312Z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
    />
  </svg>
);
