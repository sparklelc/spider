sinaWeiboSpider
===============
ʹ��node.jsд������΢���������Ŀǰ���Ǵ�����һ���û���ʼ�ݹ���ȡ��˿����follow���ˣ�������Ϳ��Ըĳ���ȡ������Ϣ��
������ռ��ƪ���ľ�������΢���ĵ�¼��Ϊ�˷�ֹ���棬����΢���ĵ�¼���������Ƿǳ��������ʵ��´���Ҳ�Ƚ��鷳��

��ԭ������ܶ������ʵ�����Ҳ��Թ������������������ô��룬��������¼��������ȡ����ʵֻ��main.js��
��Ȼ������main.js֮ǰ������Ҫ�Ƚ�mongodb������������Ҳ���Խ��Ҵ����з������ݿ�Ĵ���ɾ�������п�Ч����

�����ֻ������ȡ΢�����ݣ��Ǿ͸����ˣ���������Ҫ��ģ���¼��ֻ��Ҫ����useraget�Ϳ����ˣ���Ϊ������Ȼ��Ҫ��ֹ������ͨ�û���������ȡ��������ϣ�����Ա�����������ȡ����������ֻ��Ҫ����һ��google����baidu��user agent�Ϳ����ˣ����߸��򵥵�ֱ������spider����:

    var Request = require('request');
    var site = "http://weibo.com/rmrb";

    Request.get({uri:site,headers: {
        'User-Agent': 'spider'
    }},function(err,response,body){
        if(err){
            console.log("����" + site +  "ʧ��")
            console.log(err);
        }
        else{
            console.log("����" + site +  "���")
            var match = body.match(/\d+\.\d+\.\d+\.\d+/g);
    
            console.log(body);
    }});
	
dailypost.js��������ȡÿ��ÿ�յ�΢�����ݵģ���д����ʱ����˳������¼�Ĵ��뵥����ȡ�˳�����Ҳ����weibologin.js��
