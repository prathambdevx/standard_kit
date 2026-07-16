'use client';

import { useState } from 'react';

import { ReviewStarIcon } from '@/assets/icons/review_star_icon';
import { Button } from '@/components/ui/button';

type Props = {
  value: number;
  onChange: (v: number) => void;
  count?: number;
};

/** Interactive star-picker; hover previews the rating before committing on click. */
export const StarRating = ({ value, onChange, count = 5 }: Props) => {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: count }, (_, i) => {
        const star = i + 1;
        const filled = star <= (hover || value);
        return (
          <Button
            key={star}
            variant="none"
            type="button"
            aria-label={`Rate ${star} out of ${count}`}
            aria-pressed={value === star}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(0)}
          >
            <ReviewStarIcon
              filled={filled}
              className={filled ? 'size-5 text-review-star' : 'size-5 text-dim'}
            />
          </Button>
        );
      })}
    </div>
  );
};
