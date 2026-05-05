"use client"

import * as React from "react"
import { useLocation } from "react-router-dom"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useAuth } from "@/context/AuthContext"
import {
  CalendarDaysIcon,
  CalendarIcon,
  GalleryVerticalEndIcon,
  ScanBarcodeIcon,
  ShoppingCartIcon,
} from "lucide-react"

/** Collapsible icon sidebar — nav matches Internal POS routes. */
export function AppSidebar( { ...props }: React.ComponentProps<typeof Sidebar> ) {
  const { pathname } = useLocation()
  const { canManageEvents, canUsePos, canValidateTickets, currentUser, site } = useAuth()

  const calendarNavActive = pathname === "/" || pathname === "/calendar"
  const checkoutActive = pathname === "/checkout"
  const validateActive = pathname === "/validate"
  const manageEventsActive =
    pathname === "/events" || pathname.startsWith( "/event/" )

  const user = {
    name: currentUser?.name ?? "Guest",
    email: currentUser?.email ?? "",
    avatarUrl: currentUser?.avatarUrl ?? "",
  }

  const siteName = site?.name?.trim() || "Internal POS"

  const teams = React.useMemo(
    () => [
      {
        name: siteName,
        logo: <GalleryVerticalEndIcon className="size-4 shrink-0" />,
        plan: "Store",
      },
    ],
    [ siteName ]
  )

  const navMain = React.useMemo( () => {
    const items = []
    if ( canUsePos ) {
      items.push(
        {
          title: "Calendar",
          url: "/calendar",
          icon: <CalendarIcon className="size-4 shrink-0" />,
          isActive: calendarNavActive,
        },
        {
          title: "Checkout",
          url: "/checkout",
          icon: <ShoppingCartIcon className="size-4 shrink-0" />,
          isActive: checkoutActive,
        },
      )
    }
    if ( canValidateTickets ) {
      items.push( {
        title: "Validate",
        url: "/validate",
        icon: <ScanBarcodeIcon className="size-4 shrink-0" />,
        isActive: validateActive,
      } )
    }
    if ( canManageEvents ) {
      items.push( {
        title: "Manage Events",
        url: "/events",
        icon: <CalendarDaysIcon className="size-4 shrink-0" />,
        isActive: manageEventsActive,
      } )
    }
    return items
  }, [
    calendarNavActive,
    checkoutActive,
    validateActive,
    canUsePos,
    canManageEvents,
    canValidateTickets,
    manageEventsActive,
  ] )

  return (
    <Sidebar collapsible="icon" { ...props }>
      <SidebarHeader>
        <TeamSwitcher teams={ teams } />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={ navMain } />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={ user } />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
