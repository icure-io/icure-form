import { CodeStub, Contact, Content, Service } from '@icure/api'
import { groupBy, sortedBy } from '../../utils/no-lodash'
import { fuzzyDate, isServiceContentEqual, setServices } from '../../utils/icure-utils'
import { ServicesHistory, ServiceWithContact } from './models'

export function withLabel(label: string): (svc: Service) => boolean {
	return (svc: Service) => svc.label === label
}

export interface FormValuesContainer {
	copy(currentContact: Contact): FormValuesContainer
	getVersions(selector: (svc: Service) => boolean): ServicesHistory
	setValue(serviceId: string, language: string, content: Content, codes: CodeStub[]): FormValuesContainer
	setValueDate(serviceId: string, fuzzyDate: number | null): FormValuesContainer
	setAuthor(serviceId: string, author: string | null): FormValuesContainer
	setResponsible(serviceId: string, responsible: string | null): FormValuesContainer
	delete(serviceId: string): FormValuesContainer
}

export class ICureFormValuesContainer implements FormValuesContainer {
	currentContact: Contact //The contact of the day, used to record modifications
	contact: Contact //The displayed contact (may be in the past). === to currentContact if the contact is the contact of the day
	contactsHistory: Contact[] //Must be sorted (most recent first), does not include currentContent but must include contact (except if contact is currentContact)

	serviceFactory: (language: string, content: Content) => Service

	constructor(currentContact: Contact, contact: Contact, contactsHistory: Contact[], serviceFactory: (language: string, content: Content) => Service) {
		if (!contactsHistory.includes(contact) && contact !== currentContact) {
			throw new Error('Illegal argument, the history must contain the contact')
		}
		if (contactsHistory.includes(currentContact)) {
			throw new Error('Illegal argument, the history must not contain the currentContact')
		}
		this.currentContact = currentContact
		this.contact = contact
		this.contactsHistory = sortedBy(contactsHistory, 'created', 'desc')
		this.serviceFactory = serviceFactory
	}

	copy(currentContact: Contact): ICureFormValuesContainer {
		return new ICureFormValuesContainer(currentContact, this.contact, this.contactsHistory, this.serviceFactory)
	}

	getVersions(selector: (svc: Service) => boolean): ServicesHistory {
		return groupBy(
			this.getServicesInHistory(selector).filter((swc) => +(fuzzyDate(swc.contact.created) || 0) <= +(fuzzyDate(this.contact.created) || 0)),
			(swc) => swc.service.id || '',
		)
	}

	private setServiceProperty<K>(serviceId: string, newValue: K, getter: (svc: Service) => K, setter: (svc: Service, value: K) => Service): FormValuesContainer {
		const swcs = this.getServicesInHistory((s) => s.id === serviceId)
		if (swcs.length) {
			if (newValue !== getter(swcs[0].service)) {
				return this.copy(setServices(this.currentContact, [], [setter(swcs[0].service, newValue)]))
			} else {
				return this
			}
		} else {
			return this
		}
	}

	setValueDate(serviceId: string, fuzzyDate: number | null): FormValuesContainer {
		return this.setServiceProperty(
			serviceId,
			fuzzyDate,
			(s) => s.valueDate,
			(s) => new Service({ ...s, valueDate: fuzzyDate }),
		)
	}

	setAuthor(serviceId: string, author: string | null): FormValuesContainer {
		return this.setServiceProperty(
			serviceId,
			author,
			(s) => s.author,
			(s) => new Service({ ...s, author }),
		)
	}

	setResponsible(serviceId: string, responsible: string | null): FormValuesContainer {
		return this.setServiceProperty(
			serviceId,
			responsible,
			(s) => s.author,
			(s) => new Service({ ...s, responsible }),
		)
	}

	setValue(serviceId: string, language: string, content: Content, codes: CodeStub[]): FormValuesContainer {
		const swcs = this.getServicesInHistory((s) => s.id === serviceId)
		if (swcs.length) {
			const previousContent = swcs[0].service.content

			if (!previousContent || !isServiceContentEqual({ [language]: content }, previousContent)) {
				// Omit end of life
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { endOfLife, ...modifiedServiceValues } = {
					...swcs[0].service,
					content: { ...previousContent, [language]: content },
					codes: codes,
					modified: +new Date(),
				}
				return this.copy(setServices(this.currentContact, [], [new Service(modifiedServiceValues)]))
			} else {
				return this
			}
		} else {
			return this.copy(setServices(this.currentContact, [this.serviceFactory(language, content)], []))
		}
	}

	delete(serviceId: string): FormValuesContainer {
		const swcs = this.getServicesInHistory((s) => s.id === serviceId)
		if (swcs.length) {
			//Omit end of life
			const now = +new Date()
			return this.copy(
				setServices(
					this.currentContact,
					[],
					[
						new Service({
							...swcs[0].service,
							content: {},
							modified: now,
							endOfLife: now,
						}),
					],
				),
			)
		} else {
			return this
		}
	}

	/** returns all services in history that match a selector
	 *
	 * @param selector a function used to select the services of interest, usually : withLabel("someLabel")
	 * @private
	 */
	private getServicesInHistory(selector: (svc: Service) => boolean): ServiceWithContact[] {
		return [this.currentContact].concat(this.contactsHistory).flatMap(
			(ctc) =>
				ctc.services?.filter(selector)?.map((s) => ({
					service: s,
					contact: ctc,
				})) || [],
		)
	}
}
