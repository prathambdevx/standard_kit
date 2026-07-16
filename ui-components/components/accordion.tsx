'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as React from 'react';

import { MinusLineIcon } from '@/assets/icons/minus_line_icon';
import { PlusIcon } from '@/assets/icons/plus_icon';
import { cn } from '@/lib/cn';

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item ref={ref} className={cn('border-b', className)} {...props} />
));
AccordionItem.displayName = 'AccordionItem';

const AccordionTrigger = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
    icon?: React.ReactNode;
    iconStyle?: string;
    showIcon?: boolean;
  }
>(({ className, children, icon, showIcon = true, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex" asChild>
    <div>
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          'transition-smooth flex flex-1 cursor-pointer items-center justify-between font-medium outline-hidden',
          className,
        )}
        {...props}
      >
        {children}
        {showIcon &&
          (icon ? (
            icon
          ) : (
            <>
              <PlusIcon className="size-3 shrink-0 [[data-state=open]_&]:hidden lg:size-3.5" />
              <MinusLineIcon className="size-3 shrink-0 hidden [[data-state=open]_&]:block text-ink lg:size-3.5" />
            </>
          ))}
      </AccordionPrimitive.Trigger>
    </div>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className={cn(
      'transition-smooth overflow-hidden',
      'data-[state=closed]:animate-accordion-up',
      'data-[state=open]:animate-accordion-down',
    )}
    {...props}
  >
    <div className={className}>{children}</div>
  </AccordionPrimitive.Content>
));

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
