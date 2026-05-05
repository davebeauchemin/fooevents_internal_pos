import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/context/AuthContext"
import { ChevronsUpDownIcon, BadgeCheckIcon, LogOutIcon } from "lucide-react"

function initialsFromName( name: string ) {
  const parts = name.trim().split( /\s+/ ).filter( Boolean )
  if ( parts.length === 0 ) {
    return "U"
  }
  if ( parts.length === 1 ) {
    return parts[ 0 ].slice( 0, 2 ).toUpperCase()
  }
  return ( parts[ 0 ][ 0 ] + parts[ parts.length - 1 ][ 0 ] ).toUpperCase()
}

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatarUrl: string
  }
}) {
  const { isMobile } = useSidebar()
  const { logoutUrl, profileUrl } = useAuth()
  const initials = initialsFromName( user.name )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatarUrl} alt={user.name} />
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              { profileUrl ? (
                <DropdownMenuItem asChild>
                  <a href={profileUrl}>
                    <BadgeCheckIcon
                    />
                    Account
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem>
                  <BadgeCheckIcon
                  />
                  Account
                </DropdownMenuItem>
              ) }
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            { logoutUrl ? (
              <DropdownMenuItem asChild>
                <a href={logoutUrl}>
                  <LogOutIcon
                  />
                  Log out
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem>
                <LogOutIcon
                />
                Log out
              </DropdownMenuItem>
            ) }
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
