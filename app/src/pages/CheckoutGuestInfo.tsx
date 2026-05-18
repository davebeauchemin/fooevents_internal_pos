import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCheckoutDraft } from '@/context/CheckoutDraftContext';
import { useCart } from '@/context/CartContext';

type HandoffPhase = 'entry' | 'waiting';

export default function CheckoutGuestInfo() {
	const formId = useId();
	const navigate = useNavigate();
	const { items } = useCart();
	const {
		first,
		last,
		email,
		postalCode,
		setFirst,
		setLast,
		setEmail,
		setPostalCode,
	} = useCheckoutDraft();

	const [ phase, setPhase ] = useState<HandoffPhase>( 'entry' );

	useEffect( () => {
		if ( items.length === 0 ) {
			navigate( '/checkout', { replace: true } );
		}
	}, [ items.length, navigate ] );

	const goBackToCheckout = () => {
		navigate( '/checkout', { replace: true } );
	};

	const beginStaffHandoff = () => {
		setPhase( 'waiting' );
	};

	const completeStaffTakeover = () => {
		goBackToCheckout();
	};

	const showStaffLoadingScreen = () => {
		setPhase( 'waiting' );
	};

	if ( items.length === 0 ) {
		return null;
	}

	const cardFooterClassName =
		'border-border flex flex-col-reverse gap-3 border-t sm:flex-row sm:flex-nowrap sm:justify-between';

	return (
		<div className="bg-background flex min-h-[100dvh] flex-col">
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
				<div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-5 py-6 sm:max-w-lg sm:px-10">
					<div className="w-full shrink-0">
						{ phase === 'entry' ? (
							<Card className="border-border shadow-md">
								<CardHeader className="text-left">
									<CardTitle className="font-heading text-2xl font-semibold tracking-tight">
										Enter your information
									</CardTitle>
									<CardDescription className="text-base leading-relaxed">
										Add your details for this booking. Payment and totals are handled on the staff
										checkout screen after you hand the device back.
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="grid gap-4 text-left sm:max-w-lg">
										<div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
											<div className="grid gap-2">
												<Label htmlFor={ `${ formId }-guest-first` }>
													First name{ ' ' }
													<span className="text-muted-foreground font-normal">(optional)</span>
												</Label>
												<Input
													id={ `${ formId }-guest-first` }
													value={ first }
													onChange={ ( e ) => setFirst( e.target.value ) }
													maxLength={ 100 }
													autoComplete="given-name"
													placeholder="Leave blank if unknown"
												/>
											</div>
											<div className="grid gap-2">
												<Label htmlFor={ `${ formId }-guest-last` }>
													Last name{ ' ' }
													<span className="text-muted-foreground font-normal">(optional)</span>
												</Label>
												<Input
													id={ `${ formId }-guest-last` }
													value={ last }
													onChange={ ( e ) => setLast( e.target.value ) }
													maxLength={ 100 }
													autoComplete="family-name"
													placeholder="Leave blank if unknown"
												/>
											</div>
											<div className="grid gap-2 sm:col-span-2">
												<Label htmlFor={ `${ formId }-guest-email` }>
													Email{ ' ' }
													<span className="text-muted-foreground font-normal">(optional)</span>
												</Label>
												<Input
													id={ `${ formId }-guest-email` }
													type="email"
													value={ email }
													onChange={ ( e ) => setEmail( e.target.value ) }
													placeholder="Uses store default if left blank"
													autoComplete="email"
												/>
											</div>
											<div className="grid gap-2 sm:col-span-2">
												<Label htmlFor={ `${ formId }-guest-postal` }>
													Postal code{ ' ' }
													<span className="text-muted-foreground font-normal">(optional)</span>
												</Label>
												<Input
													id={ `${ formId }-guest-postal` }
													type="text"
													value={ postalCode }
													onChange={ ( e ) => setPostalCode( e.target.value ) }
													maxLength={ 50 }
													autoComplete="postal-code"
													inputMode="text"
													placeholder="Leave blank if unknown"
												/>
											</div>
										</div>
									</div>
								</CardContent>
								<CardFooter className={ cardFooterClassName }>
									<Button
										type="button"
										variant="outline"
										className="w-full sm:w-auto"
										onClick={ showStaffLoadingScreen }
									>
										Back
									</Button>
									<Button
										type="button"
										className="w-full sm:ml-auto sm:w-auto"
										onClick={ beginStaffHandoff }
									>
										Return the device to the staff
									</Button>
								</CardFooter>
							</Card>
						) : (
							<Card className="border-border shadow-md">
								<CardContent className="flex flex-col gap-4 pt-6 text-left">
									<div className="flex min-w-0 flex-row items-center gap-3">
										<Loader2
											className="text-muted-foreground size-10 shrink-0 animate-spin sm:size-12"
											aria-hidden
										/>
										<h2 className="font-heading min-w-0 text-2xl font-semibold tracking-tight">
											Loading Staff
										</h2>
									</div>
									<p className="text-muted-foreground text-base leading-relaxed">
										Hold the tablet or device steady and return it to a staff member—they will
										continue checkout on the staff screen.
									</p>
								</CardContent>
								<CardFooter className={ cardFooterClassName }>
									<Button
										type="button"
										variant="outline"
										className="w-full sm:w-auto"
										onClick={ () => setPhase( 'entry' ) }
									>
										Back
									</Button>
									<Button
										type="button"
										className="w-full sm:ml-auto sm:w-auto"
										onClick={ completeStaffTakeover }
									>
										Take over
									</Button>
								</CardFooter>
							</Card>
						) }
					</div>
				</div>
			</div>
		</div>
	);
}
