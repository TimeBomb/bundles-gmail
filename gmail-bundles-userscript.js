// ==UserScript==
// @name         Gmail Bundles
// @version      0.1.1 pre-alpha
// @description  Implement Google Inbox's bundles into Gmail. Or as close as we can get it.
// @author       http://github.com/TimeBomb
// @match        https://mail.google.com/*
// @grant        none
// ==/UserScript==

/* Plan:
Requirements:
- Bundle should be placed in position of most recent email in that bundle.
- Bundle should show email sender in place of email subject, should show up to 3 email senders, showing the most recent emails' senders
- Will need to figure out how to move bundles if new, bundled email is received.
- If email has attachment (there is icon representing this), should show attachment icon in bundle
Plan Notes:
- Use MutationObserver to check email table if new email is received, then rebundle (See if it's performant & easier to rebundle everything. If not, only rebundle new things.) Need to handle not rebundling if email table is no longer being viewed, e.g. if someone views individual email.
- Identify email as part of bundle based on label. Then replace most recent email with bundle in DOM. Hide all emails with that label, identify them as part of the bundle via a class. Then move them around in DOM when bundle is opened. Hide them again when bundle is closed.
- How exactly should we define bundles? User defined? Bundle by label? What if there are multiple labels? Most used / least used label?
- Try to figure out some style for bundles and their opened emails. Try to use preexisting classes/colors if possible.
- Q: Do we hide emails in DOM and move them around when bundling? Or do we store them in JS and leverage them when bundling?
- A: Let's probably just hide emails in DOM. That way we don't have to lose performance removing/adding entire elements via JS.
- Self Note: It looks like all emails that are loaded in-app are loaded into the same table
- Self Note: Make sure to test without any GMail extensions enabled, and also test with them enabled [e.g. Inbox theme]
*/
// TODO: Split into multiple classes or multiple (function() {})() based off logic, for easier maintainability/readability
(function() {
	'use strict';

	// DOM class constants
    const LOADING_CLASS = '#loading'; // Gmail loading class, used to detect when we can initialize our bundlizer
	const ALL_EMAIL_TABLE_CLASS = '.aeF'; // All emails, even hidden email lists from opening labels/etc
	const VISIBLE_EMAIL_TABLE_CLASS = '.BltHke[role=main] .F'; // Contains email list of all visible emails, `.BltHke` can exist more than once per folder/label opened, `role=main` only gets visible one
	const EMAIL_CLASS = '.zA'; // Single email row in list
	const EMAIL_DEFAULT_DISPLAY = 'flex'; // CSS property used when making an email visible again after hiding it.
	const EMAIL_LABEL_WRAPPER_CLASS = '.at'; // Class containing text and background color of label of single email row, one element per label
	const EMAIL_LABEL_CLASS = '.av'; // Used to label email text color

	// DOM class constants used by bundle template HTML
	const EMAIL_UNREAD_CLASS = 'zE'; // .zE is applied to the email class .zA only if it's an unread email
	const EMAIL_SENDER_CLASS = '.yW .yP'; // Class containing sender name and attributes related to sender. `.yP` is the sender class, `.yW` is visible text only.
	const EMAIL_SENDER_WRAPPER_CLASS = '.bA4'; // Class wrapping sender class, used to style bundle name, and also to get recent senders
	const EMAIL_SUBJECT_CLASS = '.bog'; // Class containing email subject
	const EMAIL_SENT_DATE_CLASS = '.xW span span'; // Class containing email sent date to the right of email attachment icon
	const REMOVED_CLASSES = {
		EMAIL_THREAD_COUNT: '.bx0', // The number of messages in the email thread
		IMPORTANT_TAG_CLASS: '.pG', // The important arrow to the left of the email sender
		HIDDEN_SENDER_CLASS: '.afn', // Class containing hidden text about the email sender
		LABEL_CLASS: '.yi', // Class containing labels to the left of email subject
		EMAIL_DESC_CLASS: '.y2', // Class containing description to the right of email subject
		EMAIL_ATTACHMENT_CLASS: '.yf', // Class containing attachment icon or nothing. To the right of email description.
		EMAIL_STAR_CLASS: '.aXw', // Class containing pin to the right of email sent date
		EMAIL_TOOLBAR_CLASS: '.bq4', // Class containing on-hover actions of email
		CHECKBOX_CLASS: '.oZ-jc', // The checkbox to the left of the email sender
	};

	// Bundle class constants used by our JS
	const BUNDLE_CLASS_PREFIX = '_js-bundle'; // Used as prefix to individual bundle elements
	const HIDDEN_EMAIL_CLASS = '_js-hidden-email'; // Used to specify that an individual email has been hidden from the DOM
	const IS_BUNDLED_CLASS = '_js-is-bundled'; // Class denoting whether an individual email is part of a bundle or not
	const EMAIL_SENDERS_SEPARATOR = '&nbsp;&nbsp;|&nbsp;&nbsp;'; // Used as separator of email senders in the bundle description
	const UNICODE_NBSP = '\u00A0';
	const MAX_SENDERS_BUNDLE_DESC = 3; // Max email senders to display as bundle description
	const BUNDLE_UPDATE_DELAY = 100; // The minimum amount of time, in milliseconds, to potentially runBundlizer if there's a DOM mutation; this is the debounce delay

	const state = {
		bundleTemplateHTML: '',
		bundles: {}, // [bundleName] : $email[], sorted list of all bundled emails
		bundlesVisibility: {}, // [bundleName] : boolean, if bundle is open
		bundlesUnread: {}, // [bundleName] : boolean, if bundle contains unread email
		bundlesOrder: [], // bundleName[] : Array of current bundle names, sorted by most recent email
	};

	// Credit: https://davidwalsh.name/javascript-debounce-function
	function debounce(func, wait, immediate) {
		let timeout;
		return function() {
			const context = this, args = arguments;
			const later = function() {
				timeout = null;
				if (!immediate) {
					func.apply(context, args);
				}
			};
			const callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) {
				func.apply(context, args);
			}
		};
	}

	// Consumed by initBundleTemplateHTML
	const cleanAttributes = ($node) => {
		Array.from($node.attributes).forEach((attribute) => {
			const attributeName = attribute.name.toLowerCase();
			if (attributeName.startsWith('js')
				|| attributeName.startsWith('data-')
				|| attributeName.startsWith('aria-')
				|| attributeName === 'id'
				|| attributeName === 'name'
				|| attributeName === 'email') {
					$node.removeAttribute(attribute.name);
			}
		});
	};

	const isBundleInDom = (bundleName) => {
		return !!document.querySelector(`.${getBundleClass(bundleName)}`);
	};

	// This method will be used to set the bundle dom code into JS once per script run.
	const initBundleTemplateHTML = () => {
        // NOTE: Had to make this stateful because we don't know exactly when we'll be ready to init bundle template HTML
        // TODO: Any way to make this not stateful?
        if (state.bundleTemplateHTML) {
            return;
        }
		const $emails = document.querySelectorAll(`${VISIBLE_EMAIL_TABLE_CLASS} ${EMAIL_CLASS}`);
		const $email = $emails[$emails.length - 1]; // Grab last email to ensure it doesn't have any type of top-of-list CSS
		const $bundleTemplate = $email.cloneNode(true);

		// First: Remove all unused classes
		Object.values(REMOVED_CLASSES).forEach((REMOVED_CLASS) => {
			const $removedElements = Array.from($bundleTemplate.querySelectorAll(REMOVED_CLASS));
			$removedElements.forEach(($removedElement) => {
				$removedElement.remove();
			});
		});

		// We can't directly set `.style` values to invalid values like template variables, thus we need random values that'll be replaced.
		// We will replace these random CSS values with template variables when setting the bundle template HTML to a string.
		const randomBackgroundColor = 'rgb(126, 140, 164)';
		const randomTextColor = 'rgb(138, 194, 21)';

		// Second: Clean attributes of all child nodes - IDs, "js*", "data-*", "name", "email"
		Array.from($bundleTemplate.querySelectorAll('*')).forEach(cleanAttributes);
		cleanAttributes($bundleTemplate);

		// Third: Replace specific fields with template vars
		$bundleTemplate.querySelector(EMAIL_SENDER_CLASS).setAttribute('data-bundle', '');
		$bundleTemplate.querySelector(EMAIL_SUBJECT_CLASS).setAttribute('data-subject', '');
		$bundleTemplate.querySelector(EMAIL_SENT_DATE_CLASS).setAttribute('data-date', '');
		// Some custom styles for our bundle name
		$bundleTemplate.querySelector(EMAIL_SENDER_WRAPPER_CLASS).style['background-color'] = randomBackgroundColor;
		$bundleTemplate.querySelector(EMAIL_SENDER_WRAPPER_CLASS).style['color'] = randomTextColor;
		$bundleTemplate.querySelector(EMAIL_SENDER_WRAPPER_CLASS).style['padding'] = '2px 4px';
		$bundleTemplate.querySelector(EMAIL_SENDER_WRAPPER_CLASS).style['border-radius'] = '4px';

		// Add final template vars when returning our output. Also include shared class to be used when targeting all bundles elements
		const displayedEmailClass = EMAIL_CLASS.replace(/\./g, ' ').trim(); // The email class as it is displayed in the HTML
		state.bundleTemplateHTML = $bundleTemplate.outerHTML
			.replace('<tr', '<div data-bundlename="{BUNDLE_NAME}"') // Ensures bundle DOM element doesn't count as email to GMail's JS
			.replace('/tr>', '/div>') // Ensures bundle DOM element doesn't count as email to GMail's JS
			.replace(/td/g, 'div') // Ensures bundle DOM element doesn't count as email to GMail's JS
			.replace('<div class="oZ-x3 xY" style="', '<div class="oZ-x3 xY" style="width: 72px;') // Ensures we correctly left-align
			.replace(displayedEmailClass, `${displayedEmailClass} ${BUNDLE_CLASS_PREFIX} {CLASS}`)
			.replace(randomBackgroundColor, '{BUNDLE-BG-COLOR}')
			.replace(randomTextColor, '{BUNDLE-TEXT-COLOR}');
	};

	// TODO: Do we still need this if we have data-bundleName?
	const getBundleClass = (bundleName) => {
		return `${BUNDLE_CLASS_PREFIX}-${bundleName}`;
	};

	// Toggle on/off bundles' emails visibility
	const onBundleClick = (event, bundleName) => {
		const turnOffBundleVisibility = (_bundleName) => {
			hideEmails(state.bundles[_bundleName]);
			showUnbundledEmails();
			const bundlesResetPosition = [...state.bundlesOrder]
				.splice(state.bundlesOrder.indexOf(_bundleName) + 1, state.bundlesOrder.length);
			resetBundleDomsPosition(bundlesResetPosition);
		};

		// Turn off currently visible bundle first, to reset bundle doms position appropriately among other things
		const visibleBundleName = getVisibleBundleName();
		if (state.bundlesVisibility[bundleName] === false && visibleBundleName) {
			state.bundlesVisibility[visibleBundleName] = false;
			turnOffBundleVisibility(visibleBundleName);
		}

		state.bundlesVisibility[bundleName] = !state.bundlesVisibility[bundleName];
		if (state.bundlesVisibility[bundleName]) {
			showBundledEmails(bundleName)
		} else {
			turnOffBundleVisibility(bundleName);
		}

		updateBundleDom(bundleName); // Update open/closed status on bundle
	};

	const getEmailLabelWrapperOfBundle = ($email, bundleName) => {
		return Array.from($email.querySelectorAll(EMAIL_LABEL_WRAPPER_CLASS)).find(($emailLabel) => {
			return $emailLabel.innerText === bundleName;
		});
	};

	// This method creates a single bundle DOM element adjacent right above the specified $email
	// Set isPlacedAfter to `true` to instead insert bundle DOM below $email
	//  Used for moving bundle DOM around when opening other bundles
	const insertBundleDom = ($email, bundleName, isPlacedAfter) => {
		console.log('inserting bundle', bundleName);
		const bundleClass = getBundleClass(bundleName);
		const $latestBundledEmail = state.bundles[bundleName][0];
		if (document.querySelector(`.${bundleClass}`)) {
			return;
		}

		const $emailLabelWrapper = getEmailLabelWrapperOfBundle($latestBundledEmail, bundleName);

		$email.insertAdjacentHTML(isPlacedAfter ? 'afterend' : 'beforebegin', state.bundleTemplateHTML
			.replace('{CLASS}', bundleClass)
			.replace('{BUNDLE_NAME}', bundleName)
			.replace('{BUNDLE-BG-COLOR}', $emailLabelWrapper.style['background-color'])
			.replace('{BUNDLE-TEXT-COLOR}', $emailLabelWrapper.querySelector(EMAIL_LABEL_CLASS).style['color'])
		);

		document.querySelector(`.${bundleClass}`).addEventListener('click', (event) => {
			onBundleClick(event, bundleName);
		});

		updateBundleDom(bundleName);
	};

	// Updates bundle DOM unread status, email count, email senders
	// TODO: Maybe update label colors?
	const updateBundleDom = (bundleName) => {
		const bundle = state.bundles[bundleName];
		const bundleClass = getBundleClass(bundleName);
		const $bundle = document.querySelector(`.${bundleClass}`);
		if (!$bundle) {
			console.warn('Trying to update bundle that was not found in DOM: ', bundleName);
			return;
		}

		console.log('updating bundle maybe', bundleName);
		const $latestEmail = bundle[0];
		const isBundleOpen = state.bundlesVisibility[bundleName];
		const isUnread = $latestEmail.classList.contains(EMAIL_UNREAD_CLASS) || state.bundlesUnread[bundleName];
		const renderedEmailCount = `[${bundle.length}]`;
		let renderedBundleName = `${bundleName} ${renderedEmailCount}`;
		renderedBundleName =  isUnread ? `<strong>${renderedBundleName}</strong>` : renderedBundleName;
		renderedBundleName = isBundleOpen ? `<u>${renderedBundleName}</u>` : renderedBundleName;
		const recentSenders = getRecentSenders(bundleName);
		const emailDate = $latestEmail.querySelector(EMAIL_SENT_DATE_CLASS).innerText;

		const $bundleName = $bundle.querySelector('[data-bundle]');
		const $emailSenders = $bundle.querySelector('[data-subject]')
		const $lastReceivedEmailDate = $bundle.querySelector('[data-date]');
		if ($bundleName.innerHTML.trim() !== renderedBundleName.trim()) {
			$bundleName.innerHTML = renderedBundleName;
		}
		// Compare innerText so that we don't have to deal with HTML entities, e.g. &amp; vs &
		// Replace &nbsp; with UNICODE_NBSP to appropriately match & compare the value of innerText
		if ($emailSenders.innerText.trim() !== recentSenders.join(EMAIL_SENDERS_SEPARATOR.replace(/&nbsp;/g, UNICODE_NBSP)).trim()) {
			$emailSenders.innerHTML = recentSenders.join(EMAIL_SENDERS_SEPARATOR);
		}
		if ($lastReceivedEmailDate.innerText.trim() !== emailDate.trim()) {
			$lastReceivedEmailDate.innerText = emailDate;
		}
	};

	// TODO OLD: Calling this more often may help fix some bugs outlined in TODO comments below
	// TODO: Possible to stablely alter bundles instead of overwriting it?
	// TODO: Would be nicer if this was less stateful...
	// Sort all email DOM nodes into an object of arrays, each key representing a label
	const setBundleStateToEmails = ($emails) => {
		console.log('setting bundle state to email, incl updating bundle order');
		const bundles = {};
		const bundlesUnread = {};
		const bundlesOrder = []; // `querySelectorAll` is ordered from top-most element to bottom-most, which translates to most-recent to least-recent email
		$emails.forEach(($email) => {
			const $emailLabels = Array.from($email.querySelectorAll(EMAIL_LABEL_CLASS));
			// Don't bundle emails with no labels
			if (!$emailLabels.length) {
				return;
			}

			$email.classList.add(IS_BUNDLED_CLASS);
			$emailLabels.forEach(($emailLabel) => {
				const label = $emailLabel.innerText;
				if (!bundles[label]) {
					bundlesOrder.push(label);
				}
				bundles[label] = bundles[label] || [];
				bundles[label].push($email);

				if ($email.classList.contains(EMAIL_UNREAD_CLASS)) {
					// bundlesUnread[label] === undefined means there are no unread emails in the bundle
					bundlesUnread[label] = true;
				}
			});
		});

		state.bundlesUnread = bundlesUnread;
		state.bundlesOrder = bundlesOrder;
		state.bundles = bundles;
	}

	// Get most recent 1-3 email senders of specified bundle
	// Displayed in the email subject area for the bundle DOM, mirroring Google Inbox
	const getRecentSenders = (bundleName) => {
		const bundle = state.bundles[bundleName];
		const emailSenders = [];
		for(var i = 0; i < MAX_SENDERS_BUNDLE_DESC; i++) {
			const $email = bundle[i];
			if (!$email) {
				break;
			}

			// TODO: In Apartments label, after switching many labels, bundling breaks with a console error `Cannot read property 'innerText' of null` Why?
			emailSenders.push($email.querySelector(EMAIL_SENDER_WRAPPER_CLASS).innerText);
		}

		return emailSenders;
	};

	const moveBundleDoms = ($email, bundleNames, isPlacedAfter) => {
		console.log('moving bundles:', bundleNames);
		bundleNames.reverse().forEach((bundleName) => {
			const $bundle = document.querySelector(`[data-bundlename="${bundleName}"]`);
			// We don't want to move the bundle if it's already appropriately in position.
			//  If we were to do that, we'd cause a redundant loop of the DOM being updated thanks to our mutatationobserver
			// Get a list of all emails before/after $email
			const $allEmails = Array.from($email.parentElement.querySelectorAll(EMAIL_CLASS));
			const $positionedEmails = isPlacedAfter ?
				$allEmails.splice($allEmails.indexOf($email), $allEmails.length)
				: $allEmails.splice(0, $allEmails.indexOf($email));

			// Only update the position of our bundle if our bundle is out of position
			// TODO: This conditional check is NOT good enough
			//  If the bundle order should be [Shipping, Kickstarter], but the current order is [Kickstarter, Shipping],
			//   then this check will NOT trigger even though it should, because $positionedEmails includes both of the bundles.
			//  Maybe we should iterate over positionedEmails instead of the bundles?
			if (!$positionedEmails.includes($bundle)) {
				$bundle.remove();
				insertBundleDom($email, bundleName, isPlacedAfter);
			}
		});
	};

	// Resets all bundle DOMs back to their appropriate position, depending on whether a bundle is opened or they're all closed
	const resetBundleDomsPosition = () => {
		const bundleNames = Object.keys(state.bundles);
		const visibleBundleName = getVisibleBundleName();
		if (visibleBundleName) { // If a bundle is open, order necessary bundle DOMs after open bundle
			const visibleBundle = state.bundles[visibleBundleName];
			const bundlesAfterVisibleBundle = [...state.bundlesOrder]
			.splice(state.bundlesOrder.indexOf(visibleBundleName) + 1, state.bundlesOrder.length);
			console.log('moving bundles after this bundle', bundlesAfterVisibleBundle);
			moveBundleDoms(visibleBundle[visibleBundle.length - 1], bundlesAfterVisibleBundle, true);
		} else { // If all bundles are closed, position bundles in the spot of their latest email
			bundleNames.forEach((bundleName) => {
				const $latestEmail = state.bundles[bundleName][0];
				moveBundleDoms($latestEmail, [bundleName]);
			});
		}
	};

	// Show only bundled emails, hide everything else.
	// We must hide at minimum every email between the bundled emails,
	//  as Gmail relies heavily on the order the email was originally in when displaying an email that's been clicked on
	const showBundledEmails = (bundleName) => {
		const bundle = state.bundles[bundleName];
		console.log('showBundledEmails', bundleName);

		// TODO: Maybe reduce $emailsToHide instead of doing bundles.forEach?
		// Hide emails that aren't in the shown bundle
		const $emailsToHide = Array.from(document.querySelectorAll(`${VISIBLE_EMAIL_TABLE_CLASS} ${EMAIL_CLASS}:not(.${BUNDLE_CLASS_PREFIX})`));
		// Unhide emails that are in shown bundle
		bundle.forEach(($email) => {
			$emailsToHide.splice($emailsToHide.indexOf($email), 1);
			if ($email.classList.contains(HIDDEN_EMAIL_CLASS)) {
				$email.classList.remove(HIDDEN_EMAIL_CLASS);
				$email.style.display = EMAIL_DEFAULT_DISPLAY;
			}
		});

		hideEmails($emailsToHide);

		// Move visible bundles below list of bundled emails,
		//  rather than potentially in the middle of the bundled emails list
		// TODO: Once this call is updated (see TODO comment on resetBundle method), we may be able to remove this call since runBundlizer already calls it
		resetBundleDomsPosition();
	};

	// When we want to toggle a bundle off, we want to show emails that we hid in showBundledEmails
	const showUnbundledEmails = () => {
		console.log('showing unbundled emails');
		const $emailsToShow = Array.from(document.querySelectorAll(`${VISIBLE_EMAIL_TABLE_CLASS} ${EMAIL_CLASS}.${HIDDEN_EMAIL_CLASS}:not(.${IS_BUNDLED_CLASS})`));
		$emailsToShow.forEach(($email) => {
			$email.classList.remove(HIDDEN_EMAIL_CLASS);
			$email.style.display = EMAIL_DEFAULT_DISPLAY;
		});
	};

	const hideEmails = ($emails) => {
		$emails.forEach(($email) => {
			// Add a class to allow us to later select and unhide all programatically hidden emails
			if (!$email.classList.contains(HIDDEN_EMAIL_CLASS)) {
				console.log('hiding email for real', $emails);
				$email.classList.add(HIDDEN_EMAIL_CLASS);
				$email.style.display = 'none';
			}
		});
	};

	const getVisibleBundleName = () => {
		return Object.keys(state.bundlesVisibility).find((key) => {
			return state.bundlesVisibility[key];
		});
	};

	// TODO: MAYBE FIXED Sometimes more emails are removed than should be, i.e. ones unrelated to bundles. Can repro by switching from inbox to label then back to inbox
	// TODO IMPORTANT: MAYBE FIXED after converting bundle dom from tr/td to div... original: There are definitely some bugs when switching to/from labels. I eventually saw `Cannot read property 'addEventListener' of null at insertBundleDom (<anonymous>:139:44)`
	//  MAYBE FIXED Gmail also starts bugging out when you switch labels. Forever `Loading` tooltip at the top, Error `Error in protected function: Cannot read property 'Fy' of undefined` in console
	// TODO IMPORTANT MAYBE FIXED: After a small amount of time has passed, while opening/closing bundles, sometimes when a bundle is open, hidden non-bundled emails will become visible and mess up the indexes. Fix!
	// TODO MAYBE FIXED: After viewing email in bundle, returning to inbox only shows single email that you just opened. Should probably also update bundle state to hide all bundles when returning to inbox
	// TODO MAYBE: Sometimes we try to insert bundle DOM but the $email is no longer in the DOM, e.g. after switching back and forth in gmail labels/inbox. How do we fix this?
	// TODO: If new email is received that is going to get bundled, need to move bundle up to that email's spot, and update bundle date.
	// TODO: (Hard to repo, still happens I think) Ever since converting to a user script, sometimes a the first email from the first bundle appears when we're in the default view of not viewing any bundle. Why?
	// TODO: When you open a bundle while in a label, then go back to inbox, non-bundled emails are still hidden. Sometimes even an entire bundle is invisible. FIX?: When changing from label to inbox/vice versa, need to close all bundles.
	const runBundlizer = (m) => {
		console.log('running bundlizer', m);
        initBundleTemplateHTML();
		const $emailTable = document.querySelector(VISIBLE_EMAIL_TABLE_CLASS);
		if (!$emailTable) { // If we're not on an email list page
			return;
		}

		const $emails = Array.from($emailTable.querySelectorAll(`${VISIBLE_EMAIL_TABLE_CLASS} ${EMAIL_CLASS}`));
		setBundleStateToEmails($emails);
		const bundleNames = Object.keys(state.bundles);

		// Remove any orphaned bundles, e.g. last bundle in email had its label removed
		// If orphaned bundle is currently visible, revert to showing unbundled emails
		Array.from(document.querySelectorAll(`.${BUNDLE_CLASS_PREFIX}`))
			.forEach(($bundle) => {
				const bundleName = $bundle.getAttribute('data-bundlename');
				if (!bundleNames.includes(bundleName)) {
					if (state.bundlesVisibility[bundleName]) {
						showUnbundledEmails();
					}
					delete state.bundlesVisibility[bundleName];
					$bundle.remove();
				}
			});

		bundleNames.forEach((bundleName) => {
			const bundle = state.bundles[bundleName];
			const bundleClass = getBundleClass(bundleName);
			const $latestEmail = bundle[0];

			// Initialize bundle visibility if necessary
			state.bundlesVisibility[bundleName] = state.bundlesVisibility[bundleName] || false;

			// Initialize or update the bundle DOM
			if (!document.querySelector(`.${bundleClass}`)) {
				insertBundleDom($latestEmail, bundleName);
			} else {
				updateBundleDom(bundleName);
			}

			// Keep visibility of emails consistent
			if (!state.bundlesVisibility[bundleName]) {
				hideEmails(bundle);
			}
		});
		resetBundleDomsPosition();

		// This helps us hide emails that are no longer bundled, e.g. their label was removed
		// This also ensures we show bundled emails that are part of multiple bundles
		// TODO: Right now, this shows hidden bundled emails if they're part of the visible bundle.
		//  This is often not instant, which is bad.
		//  We should update the logic above that calls `hideEmails`, and either update `hideEmails`, add a new method, or update the logic itself
		//   to NEVER hide emails with the visible bundle's label/attribute. This'll remove the lag, and likely remove the need for this call below!
		const visibleBundleName = getVisibleBundleName();
		if (visibleBundleName) {
			showBundledEmails(visibleBundleName);
		}
	};

    const init = () => {
        const loadingNode = document.querySelector(LOADING_CLASS);
        // Note: TamperMonkey appears to call `init` multiple times, sometimes when the body only contains script tags and no loading tag. Odd.
        if (!loadingNode) {
            return;
        }
        const loadingObserver = new MutationObserver((m) => {
            // When we're done loading, the bundlizer node - all our emails - should exist
            const bundlizerNode = document.querySelector(ALL_EMAIL_TABLE_CLASS);
            // Debounce to ensure we don't call runBundlizer unnecessarily often, noteably when we call updateBundleDom
            const bundlizerObserver = new MutationObserver(debounce(runBundlizer, BUNDLE_UPDATE_DELAY));
            bundlizerObserver.observe(bundlizerNode, { childList: true, subtree: true });
            runBundlizer();
        });
        loadingObserver.observe(loadingNode, { childList: true, subtree: true, attributes: true });
    };
    init();
})();