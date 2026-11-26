import React, { useState } from 'react';
import { MAIN_ZENTRO_LOGO } from '../utils/zentroLogic';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showTagline = false,
}) => {
  const [imgError, setImgError] = useState(false);

  const imgBoxClass =
    size === 'lg'
      ? 'h-14 w-36 rounded-xl'
      : size === 'sm'
      ? 'h-9 w-24 rounded-lg'
      : 'h-11 w-28 rounded-xl';

  return (
    <div className="inline-flex items-center gap-3 shrink-0">
      <div
        className={`${imgBoxClass} overflow-hidden border border-amber-400/70 bg-slate-950 shadow-sm shrink-0 flex items-center justify-center`}
      >
        {!imgError ? (
          <img
            src={MAIN_ZENTRO_LOGO}
            alt="ZENTRO official brand logo"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <span className="font-display text-sm font-bold tracking-wider text-amber-400">
            ZENTRO
          </span>
        )}
      </div>
      {showTagline && (
        <div className="flex flex-col leading-tight">
          <span className="font-display text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap">
            ZENTRO
          </span>
          <span className="text-[11px] font-semibold tracking-widest text-amber-600 uppercase whitespace-nowrap">
            Beyond Limits
          </span>
        </div>
      )}
    </div>
  );
};
