import type { ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon } from "lucide-react"

function NavSubLink({
  to,
  children,
}: {
  to: string
  children: ReactNode
}) {
  if ( to === "#" || to.startsWith( "http://" ) || to.startsWith( "https://" ) ) {
    return <a href={to}>{children}</a>
  }
  return <Link to={to}>{children}</Link>
}

export type NavMainItem = {
  title: string
  url: string
  icon?: React.ReactNode
  isActive?: boolean
  items?: {
    title: string
    url: string
    isActive?: boolean
  }[]
}

export function NavMain( {
  groupLabel = "Pages",
  items,
}: {
  groupLabel?: string
  items: NavMainItem[]
} ) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
      <SidebarMenu>
        { items.map( ( item ) => {
          const hasSubs = Boolean( item.items && item.items.length > 0 )

          if ( ! hasSubs ) {
            return (
              <SidebarMenuItem key={ item.title }>
                <SidebarMenuButton
                  asChild
                  isActive={ item.isActive }
                  tooltip={ item.title }
                >
                  <NavLink to={ item.url }>
                    { item.icon }
                    <span>{ item.title }</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          }

          return (
            <Collapsible
              key={ item.title }
              asChild
              defaultOpen={ item.isActive }
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={ item.title } isActive={ item.isActive }>
                    { item.icon }
                    <span>{ item.title }</span>
                    <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    { item.items?.map( ( subItem ) => (
                      <SidebarMenuSubItem key={ subItem.title }>
                        <SidebarMenuSubButton
                          asChild
                          isActive={ subItem.isActive }
                        >
                          <NavSubLink to={ subItem.url }>
                            <span>{ subItem.title }</span>
                          </NavSubLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ) ) }
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        } ) }
      </SidebarMenu>
    </SidebarGroup>
  )
}
