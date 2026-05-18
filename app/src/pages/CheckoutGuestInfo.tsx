import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCheckoutDraft } from '@/context/CheckoutDraftContext';
import { useCart } from '@/context/CartContext';

const STAFF_TAKEOVER_CODE = 'kkk';

type HandoffPhase = 'entry' | 'waiting' | 'code';

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
	const [ takeoverCode, setTakeoverCode ] = useState( '' );
	const [ takeoverError, setTakeoverError ] = useState( '' );

	useEffect( () => {
		if ( items.length === 0 ) {
			navigate( '/checkout', { replace: true } );
		}
	}, [ items.length, navigate ] );

	const beginStaffHandoff = () => {
		setPhase( 'waiting' );
		setTakeoverError( '' );
		setTakeoverCode( '' );
	};

	const revealTakeoverCode = () => {
		setPhase( 'code' );
		setTakeoverError( '' );
		setTakeoverCode( '' );
	};

	const attemptTakeoverSubmit = () => {
		setTakeoverError( '' );
		if ( takeoverCode.trim() !== STAFF_TAKEOVER_CODE ) {
			setTakeoverError( 'Incorrect staff code.' );
			setTakeoverCode( '' );
			return;
		}
		setPhase( 'entry' );
		setTakeoverCode( '' );
		navigate( '/checkout', { replace: true } );
	};

	if ( items.length === 0 ) {
		return null;
	}

	return (
		<div className="bg-background flex min-h-[100dvh] flex-col">
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-10">
				<div className="mx-auto my-auto w-full max-w-md shrink-0">
					{ phase === 'entry' ? (
						<>
							<h1 className="font-heading text-center text-2xl font-semibold tracking-tight">
								Enter your information
							</h1>
							<p className="text-muted-foreground mx-auto mt-2 max-w-md text-center text-base leading-relaxed">
								Add your details for this booking. Payment and totals are handled on the staff checkout
								screen after you hand the device back.
							</p>
							<div className="mx-auto mt-8 grid w-full gap-4 text-left sm:max-w-lg">
								<div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
									<div className="grid gap-2">
										<Label htmlFor={ `${ formId }-guest-first` }>
											First name{' '}
											<span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<Input
											id={ `${ formId }-guest-first` }
											value={ first }
											onChange={ ( e ) => setFirst( e.target.value ) }
											maxLength={ 100 }
											autoComplete="given-name"
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor={ `${ formId }-guest-last` }>
											Last name{' '}
											<span className="text-muted-foreground font-normal">(optional)</span>
										</Label>
										<Input
											id={ `${ formId }-guest-last` }
											value={ last }
											onChange={ ( e ) => setLast( e.target.value ) }
											maxLength={ 100 }
											autoComplete="family-name"
										/>
									</div>
									<div className="grid gap-2 sm:col-span-2">
										<Label htmlFor={ `${ formId }-guest-email` }>Email</Label>
										<Input
											id={ `${ formId }-guest-email` }
											type="email"
											value={ email }
											onChange={ ( e ) => setEmail( e.target.value ) }
											required
											autoComplete="email"
										/>
									</div>
									<div className="grid gap-2 sm:col-span-2">
										<Label htmlFor={ `${ formId }-guest-postal` }>Postal code</Label>
										<Input
											id={ `${ formId }-guest-postal` }
											type="text"
											value={ postalCode }
											onChange={ ( e ) => setPostalCode( e.target.value ) }
											required
											maxLength={ 50 }
											autoComplete="postal-code"
											inputMode="text"
											placeholder="Customer postal / ZIP code"
										/>
									</div>
								</div>
							</div>
						</>
					) : phase === 'waiting' ? (
						<div className="flex flex-col items-center gap-6 text-center">
							<Loader2 className="text-muted-foreground size-12 shrink-0 animate-spin" aria-hidden />
							<h1 className="font-heading text-2xl font-semibold tracking-tight">
								Waiting for staff
							</h1>
							<p className="text-muted-foreground max-w-sm text-base leading-relaxed">
								Hold the tablet or device steady and return it to a staff member—they will unlock
								checkout next.
							</p>
						</div>
					) : (
						<>
							<h1 className="font-heading text-center text-2xl font-semibold tracking-tight">
								Staff takeover
							</h1>
							<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-center text-base leading-relaxed">
								Enter the staff takeover code to return to checkout.
							</p>
							<div className="mx-auto mt-8 grid w-full max-w-xs gap-2">
								<Label htmlFor={ `${ formId }-staff-code` } className="sr-only">
									Staff code
								</Label>
								<Input
									id={ `${ formId }-staff-code` }
									type="password"
									autoComplete="off"
									value={ takeoverCode }
									onChange={ ( e ) => {
										setTakeoverCode( e.target.value );
										if ( takeoverError ) {
											setTakeoverError( '' );
										}
									} }
									onKeyDown={ ( e ) => {
										if ( e.key === 'Enter' ) {
											e.preventDefault();
											attemptTakeoverSubmit();
										}
									} }
									placeholder="Staff code"
									aria-invalid={ Boolean( takeoverError ) }
								/>
								{ takeoverError ? (
									<p role="alert" className="text-destructive text-sm">
										{ takeoverError }
									</p>
								) : null }
							</div>
						</>
					) }
				</div>
			</div>
			<div className="bg-background border-border sticky bottom-0 border-t px-5 py-4 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)]">
				<div className="mx-auto flex w-full max-w-md flex-wrap items-center gap-3 sm:max-w-lg sm:flex-nowrap sm:justify-between">
					{ phase === 'entry' ? (
						<>
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto"
								onClick={ beginStaffHandoff }
							>
								Back
							</Button>
							<Button type="button" className="w-full sm:ml-auto sm:w-auto" onClick={ beginStaffHandoff }>
								Return the device to the staff
							</Button>
						</>
					) : phase === 'waiting' ? (
						<>
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto"
								onClick={ () => {
									setPhase( 'entry' );
									setTakeoverError( '' );
								} }
							>
								Back
							</Button>
							<Button type="button" className="w-full sm:ml-auto sm:w-auto" onClick={ revealTakeoverCode }>
								Take over
							</Button>
						</>
					) : (
						<>
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto"
								onClick={ () => {
									setPhase( 'waiting' );
									setTakeoverError( '' );
									setTakeoverCode( '' );
								} }
							>
								Back
							</Button>
							<Button
								type="button"
								className="w-full sm:ml-auto sm:w-auto"
								onClick={ attemptTakeoverSubmit }
							>
								Unlock checkout
							</Button>
						</>
					) }
				</div>
			</div>
		</div>
	);
}
