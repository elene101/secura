// უნდა ემთხვეოდეს backend/src/validators/auth.validator.js-ს
export const OPTIONS = {
  companyType: ['Individual', 'Online store', 'Agency / studio', 'Freelancer', 'Startup', 'Enterprise', 'Other'],
  companySize: ['Just me', '2-10', '11-50', '51-200', '200+'],
  role: ['Owner / founder', 'Developer', 'IT / security', 'Marketing', 'Other']
};


export function fillOptions(select, options, label, translate) {
  select.replaceChildren(
    new Option(translate(label), ''),
    ...options.map(option => new Option(translate(option), option))
  );
}
