import React from 'react';
import { Home, ShoppingBag, User, Users } from 'lucide-react';
import { CustomerTab } from '../types/zentro';

interface CustomerBottomNavProps {
  activeTab: CustomerTab;
  onChangeTab: (tab: CustomerTab) => void;
}

const NAV_ITEMS: { id: CustomerTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'purchased', label: 'Purchased', icon: ShoppingBag },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'me', label: 'Me', icon: User },
];

export const CustomerBottomNav: React.FC<CustomerBottomNavProps> = ({
  activeTab,
  onChangeTab,
}) => {
  return (
    <nav
      aria-label="Customer bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200"
    >
      <div className="mx-auto max-w-5xl grid grid-cols-4 items-center h-16">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative min-h-[48px] h-full flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-950 font-medium'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-12 rounded-full bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500"
                />
              )}
              <Icon className={`h-5 w-5 ${isActive ? 'text-blue-700' : 'text-slate-500'}`} />
              <span className="text-[11px] leading-none tracking-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
