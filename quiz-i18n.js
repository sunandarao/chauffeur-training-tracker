/* Welcome Check (pre / post induction) - questions in English and Hindi.
   The answer key is NOT here: it is kept only in the Apps Script (QUIZ_KEY), so it never reaches the phone.
   Keep the order of questions and options (A-D) the same in every language. Have a native speaker review the Hindi. */
window.QUIZ_I18N = {
  en: {
    name: 'English',
    ui: {
      title: 'Welcome Check', pre: 'Before induction', post: 'After induction',
      intro: '15 questions · choose one answer for each · about 10 minutes',
      code: 'Chauffeur code', noCode: 'I do not have a chauffeur code yet', name: 'Your full name', mobile: 'Mobile number',
      branch: 'Branch', pickBranch: 'Select your branch', doj: 'Date of joining',
      start: 'Start the questions', back: 'Back', submit: 'Submit answers',
      needDetails: 'Please fill your name, 10-digit mobile number and branch.', answerAll: 'Please answer all 15 questions.',
      busy: 'Too many tries from this number. Please try again after some time.', error: 'Could not save. Please check your internet and try again.',
      thanks: 'Thank you', score: 'Your score', pass: 'Well done! You know the basics already.', below: 'The induction session will cover all of this. Listen carefully!',
      again: 'Next person'
    },
    q: [
      ['What does ECO stand for?', ['Express Chauffeur Organisation', 'Emergency Commissioned Officer', 'Easy Car Operations', 'Executive Car Owners']],
      ['ECO’s promise for every journey is…', ['Quick, Quiet, Clean', 'Fast, Cheap, Easy', 'Big, Bold, Bright', 'Safe, Seamless, Trusted']],
      ['Who is your FIRST contact for any duty issue?', ['The guest', 'HR department', 'Dispatch', 'Regional Head']],
      ['How early must you reach the pickup point?', ['15 minutes early', '1 hour early', 'Exactly on time', '5 minutes early']],
      ['What must you carry for every airport pickup?', ['An extra fuel can', 'A newspaper', 'The guest’s name placard', 'Your visiting card']],
      ['On a Garage to Garage duty, what must you record accurately?', ['Km and time when you leave and return', 'Today’s fuel price', 'Names of toll plazas', 'The guest’s phone number']],
      ['On a Disposal duty, the guest asks you to wait 2 hours beyond the package. You…', ['Refuse politely', 'Leave when the package ends', 'Ask the guest for extra cash', 'Agree, and inform Dispatch at once']],
      ['Which of these is NOT allowed on duty?', ['Greeting the guest', 'Asking the guest for a tip', 'Opening the door', 'Helping with luggage']],
      ['In an emergency, what is your FIRST step?', ['Stay calm and stop safely', 'Leave the vehicle', 'Call your family', 'Call 112']],
      ['What is the ECO Speak-up Hotline number?', ['96549 99666', '100', '73035 86357', '112']],
      ['POSH is there to…', ['Check your uniform', 'Track your GPS', 'Fine chauffeurs', 'Protect you from sexual harassment']],
      ['Owned chauffeurs are paid on which date every month?', ['1st', '6th / 7th', '15th', '25th']],
      ['You earn a rating reward for every…', ['2★ or 3★ rating', 'Complaint closed', '4★ or 5★ rating', '1★ rating']],
      ['How often is Chai pe Charcha held?', ['Every week', 'Every year', 'Only on festivals', 'Every month']],
      ['Your Ops Head could not solve your issue. Who do you go to next?', ['The guest', 'Social media', 'The police', 'Your Branch Head']]
    ]
  },
  hi: {
    name: 'हिंदी',
    ui: {
      title: 'वेलकम चेक', pre: 'इंडक्शन से पहले', post: 'इंडक्शन के बाद',
      intro: '15 प्रश्न · हर प्रश्न का एक उत्तर चुनें · लगभग 10 मिनट',
      code: 'चालक कोड', noCode: 'मेरे पास अभी चालक कोड नहीं है', name: 'आपका पूरा नाम', mobile: 'मोबाइल नंबर',
      branch: 'ब्रांच', pickBranch: 'अपनी ब्रांच चुनें', doj: 'जॉइनिंग की तारीख़',
      start: 'प्रश्न शुरू करें', back: 'पीछे', submit: 'उत्तर जमा करें',
      needDetails: 'कृपया अपना नाम, 10 अंकों का मोबाइल नंबर और ब्रांच भरें।', answerAll: 'कृपया सभी 15 प्रश्नों के उत्तर दें।',
      busy: 'इस नंबर से बहुत बार कोशिश हुई है। कृपया कुछ देर बाद फिर कोशिश करें।', error: 'सेव नहीं हो सका। कृपया इंटरनेट जाँचें और फिर कोशिश करें।',
      thanks: 'धन्यवाद', score: 'आपका स्कोर', pass: 'बहुत बढ़िया! आपको बुनियादी बातें पहले से पता हैं।', below: 'इंडक्शन सत्र में ये सब बातें बताई जाएँगी। ध्यान से सुनें!',
      again: 'अगला व्यक्ति'
    },
    q: [
      ['ECO का पूरा नाम क्या है?', ['Express Chauffeur Organisation', 'Emergency Commissioned Officer', 'Easy Car Operations', 'Executive Car Owners']],
      ['हर यात्रा के लिए ECO का वादा है…', ['Quick, Quiet, Clean (तेज़, शांत, साफ़)', 'Fast, Cheap, Easy (तेज़, सस्ता, आसान)', 'Big, Bold, Bright (बड़ा, बोल्ड, चमकदार)', 'Safe, Seamless, Trusted (सुरक्षित, सहज, भरोसेमंद)']],
      ['ड्यूटी से जुड़ी किसी भी समस्या के लिए आपका पहला संपर्क कौन है?', ['गेस्ट (मेहमान)', 'HR विभाग', 'डिस्पैच', 'रीजनल हेड']],
      ['पिकअप पॉइंट पर आपको कितना पहले पहुँचना चाहिए?', ['15 मिनट पहले', '1 घंटा पहले', 'ठीक समय पर', '5 मिनट पहले']],
      ['हर एयरपोर्ट पिकअप के लिए आपको क्या साथ रखना चाहिए?', ['ईंधन का अतिरिक्त डिब्बा', 'अख़बार', 'गेस्ट के नाम की तख़्ती (प्लेकार्ड)', 'आपका विज़िटिंग कार्ड']],
      ['गैराज-टू-गैराज ड्यूटी में आपको क्या सही-सही दर्ज करना चाहिए?', ['निकलते और लौटते समय किलोमीटर और समय', 'आज का ईंधन का दाम', 'टोल प्लाज़ा के नाम', 'गेस्ट का फ़ोन नंबर']],
      ['डिस्पोज़ल ड्यूटी में गेस्ट पैकेज से 2 घंटे ज़्यादा रुकने को कहते हैं। आप…', ['विनम्रता से मना करेंगे', 'पैकेज ख़त्म होते ही चले जाएँगे', 'गेस्ट से अतिरिक्त नकद माँगेंगे', 'मान जाएँगे और तुरंत डिस्पैच को बताएँगे']],
      ['ड्यूटी पर इनमें से क्या करने की अनुमति नहीं है?', ['गेस्ट का अभिवादन करना', 'गेस्ट से टिप माँगना', 'दरवाज़ा खोलना', 'सामान उठाने में मदद करना']],
      ['आपात स्थिति में आपका पहला कदम क्या है?', ['शांत रहें और सुरक्षित जगह गाड़ी रोकें', 'गाड़ी छोड़ दें', 'अपने परिवार को फ़ोन करें', '112 पर कॉल करें']],
      ['ECO स्पीक-अप हॉटलाइन का नंबर क्या है?', ['96549 99666', '100', '73035 86357', '112']],
      ['POSH किसलिए है?', ['आपकी वर्दी जाँचने के लिए', 'आपका GPS ट्रैक करने के लिए', 'चालकों पर जुर्माना लगाने के लिए', 'आपको यौन उत्पीड़न से बचाने के लिए']],
      ['Owned चालकों को हर महीने किस तारीख़ को वेतन मिलता है?', ['1 तारीख़', '6 / 7 तारीख़', '15 तारीख़', '25 तारीख़']],
      ['आपको रेटिंग इनाम किस पर मिलता है?', ['हर 2★ या 3★ रेटिंग पर', 'हर बंद की गई शिकायत पर', 'हर 4★ या 5★ रेटिंग पर', 'हर 1★ रेटिंग पर']],
      ['चाय पे चर्चा कितनी बार होती है?', ['हर हफ़्ते', 'हर साल', 'सिर्फ़ त्योहारों पर', 'हर महीने']],
      ['आपके ऑप्स हेड आपकी समस्या हल नहीं कर पाए। अब आप किसके पास जाएँगे?', ['गेस्ट', 'सोशल मीडिया', 'पुलिस', 'आपके ब्रांच हेड']]
    ]
  }
};
