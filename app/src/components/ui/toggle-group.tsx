"use client"

import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>(
	{
		size: "default",
		variant: "default",
	},
)

function ToggleGroup( {
	className,
	variant = "default",
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
	VariantProps<typeof toggleVariants> ) {
	return (
		<ToggleGroupPrimitive.Root
			data-slot="toggle-group"
			className={ cn( "flex w-fit items-center gap-0 rounded-md outline-none", className ) }
			{ ...props }
		>
			<ToggleGroupContext.Provider value={ { variant, size } }>
				{ children }
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive.Root>
	)
}

function ToggleGroupItem( {
	className,
	children,
	variant,
	size,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
	VariantProps<typeof toggleVariants> ) {
	const ctx = React.useContext( ToggleGroupContext )

	return (
		<ToggleGroupPrimitive.Item
			data-slot="toggle-group-item"
			className={ cn(
				toggleVariants( {
					variant: variant ?? ctx.variant ?? "default",
					size: size ?? ctx.size ?? "default",
				} ),
				"min-w-0 flex-1 shadow-none focus:z-10 focus-visible:z-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90",
				className,
			) }
			{ ...props }
		>
			{ children }
		</ToggleGroupPrimitive.Item>
	)
}

export { ToggleGroup, ToggleGroupItem }
